import { describe, expect, test } from 'bun:test';
import { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { encPublicKeyFromDocument } from '../did/resolve.js';
import { createDidDocument } from '../did/create.js';
import { generateKeypair, isChannelJoinReply, PlenipoClient } from './index.js';

const baseOptions = {
  did: 'did:web:agent.example.com',
  authSecretKey: Buffer.alloc(32).toString('base64url'),
  didDocumentUrl: 'https://agent.example.com/.well-known/did.json',
};

describe('PlenipoClient relay URL handling', () => {
  test('derives https auth origin from wss relay URL', () => {
    const client = new PlenipoClient({
      ...baseOptions,
      relayUrl: 'wss://relay.example.com/agent/websocket',
    });

    expect(client.relayHttpUrl).toBe('https://relay.example.com');
  });

  test('allows insecure ws only for local development by default', () => {
    const client = new PlenipoClient({
      ...baseOptions,
      relayUrl: 'ws://localhost:4000/agent/websocket',
    });

    expect(client.relayHttpUrl).toBe('http://localhost:4000');
    expect(
      () =>
        new PlenipoClient({
          ...baseOptions,
          relayUrl: 'ws://relay.example.com/agent/websocket',
        }),
    ).toThrow('Insecure ws:// relayUrl is allowed only for localhost');
  });

  test('generateKeypair returns Ed25519 keys', async () => {
    const keypair = await generateKeypair();
    expect(keypair.publicKey.length).toBe(32);
    expect(keypair.secretKey.length).toBe(32);
  });
});

class FakeWs {
  sent: unknown[][] = [];
  private messageHandlers: Array<(data: Buffer) => void> = [];

  on(event: string, handler: (data: Buffer) => void): void {
    if (event === 'message') this.messageHandlers.push(handler);
  }

  off(event: string, handler: (data: Buffer) => void): void {
    if (event === 'message') {
      this.messageHandlers = this.messageHandlers.filter((registered) => registered !== handler);
    }
  }

  send(raw: string): void {
    const message = JSON.parse(raw) as unknown[];
    this.sent.push(message);
    const ref = message[1] as string | null;
    const event = message[3] as string;
    if (ref) {
      const response =
        event === 'balance.get'
          ? { balance: 55 }
          : event === 'receipt.list'
            ? {
                type: 'receipt.list.result',
                v: '1.0',
                receipts: [{ envelope_id: '01J', charged_tokens: 1 }],
                next_cursor: null,
              }
            : event === 'message.send'
              ? { type: 'ack', v: '1.0', envelope_id: '01JACK', status: 'queued' }
              : { ok: true };
      this.emit(['1', ref, 'relay:inbox', 'phx_reply', { status: 'ok', response }]);
    }
  }

  emit(message: unknown[]): void {
    const data = Buffer.from(JSON.stringify(message));
    for (const handler of this.messageHandlers) handler(data);
  }
}

interface ClientPrivate {
  ws: FakeWs;
  handlePhoenix(
    msg: unknown[],
    resolveConnect?: () => void,
    rejectConnect?: (err: Error) => void,
  ): void;
}

describe('PlenipoClient channel operations', () => {
  test('connect fetches challenge, signs nonce, and joins websocket', async () => {
    const originalFetch = globalThis.fetch;
    const server = new WebSocketServer({ port: 0 });
    const listening = new Promise<void>((resolve) => server.once('listening', resolve));
    await listening;
    const port = (server.address() as AddressInfo).port;
    const received: unknown[][] = [];

    server.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(Buffer.from(raw as ArrayBuffer).toString()) as unknown[];
        received.push(msg);
        setTimeout(() => {
          socket.send(JSON.stringify([msg[0], msg[1], msg[2], 'phx_reply', { status: 'ok' }]));
        }, 0);
      });
    });

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ nonce: Buffer.from('nonce').toString('base64url') }), {
        status: 200,
      })) as unknown as typeof fetch;

    try {
      const client = new PlenipoClient({
        ...baseOptions,
        relayUrl: `ws://127.0.0.1:${port}/agent/websocket`,
      });

      const connectPromise = client.connect().catch(() => undefined);
      await waitFor(() => received.length > 0);
      expect(received[0]?.[3]).toBe('phx_join');
      expect(received[0]?.[4]).toEqual({});
      void connectPromise;
      (client as unknown as { ws?: { close: () => void } }).ws?.close();
    } finally {
      globalThis.fetch = originalFetch;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('send builds a signed envelope and relay payment', async () => {
    const client = new PlenipoClient(baseOptions);
    const fakeWs = new FakeWs();
    (client as unknown as ClientPrivate).ws = fakeWs;
    const recipient = await createDidDocument('recipient.example.com');

    const ack = await client.send(
      recipient.did,
      'hello',
      encPublicKeyFromDocument(recipient.document, recipient.did),
    );

    expect(ack.status).toBe('queued');
    const sent = fakeWs.sent.at(-1);
    expect(sent?.[3]).toBe('message.send');
    const payload = sent?.[4] as {
      envelope: Record<string, string>;
      payment: { x402: string };
    };
    expect(payload.envelope.sender_did).toBe(baseOptions.did);
    expect(payload.envelope.recipient_did).toBe(recipient.did);
    expect((payload.envelope.signature ?? '').length).toBeGreaterThan(20);
    expect(payload.payment.x402.length).toBeGreaterThan(20);
  });

  test('receipt, delivery status, and balance helpers send stable events', async () => {
    const client = new PlenipoClient(baseOptions);
    const fakeWs = new FakeWs();
    (client as unknown as ClientPrivate).ws = fakeWs;

    expect(await client.sendReceipt('01JENV')).toEqual({ ok: true });
    expect(await client.getDeliveryStatus('01JENV')).toEqual({ ok: true });
    expect(await client.getBalance()).toBe(55);

    expect(await client.listReceipts({ since: '2026-06-08T20:56:00Z', limit: 5 })).toEqual({
      type: 'receipt.list.result',
      v: '1.0',
      receipts: [{ envelope_id: '01J', charged_tokens: 1 }],
      next_cursor: null,
    });

    expect(fakeWs.sent.map((message) => message[3])).toEqual([
      'message.receipt',
      'delivery.get',
      'balance.get',
      'receipt.list',
    ]);
  });

  test('isChannelJoinReply treats empty response object as join ack', () => {
    expect(isChannelJoinReply({ status: 'ok' })).toBe(true);
    expect(isChannelJoinReply({ status: 'ok', response: {} })).toBe(true);
    expect(isChannelJoinReply({ status: 'ok', response: { balance: 1 } })).toBe(false);
    expect(isChannelJoinReply({ status: 'error', response: {} })).toBe(false);
  });

  test('handlePhoenix resolves connect on join ack with empty response object', () => {
    const client = new PlenipoClient(baseOptions);
    const privateClient = client as unknown as ClientPrivate;
    let resolved = false;

    privateClient.handlePhoenix(
      ['1', null, 'relay:inbox', 'phx_reply', { status: 'ok', response: {} }],
      () => {
        resolved = true;
      },
    );

    expect(resolved).toBe(true);
  });

  test('handlePhoenix dispatches messages, receipts, and join errors', async () => {
    const client = new PlenipoClient({ ...baseOptions, autoReceipt: true });
    const privateClient = client as unknown as ClientPrivate & {
      sendReceipt: (envelopeId: string) => Promise<Record<string, unknown>>;
    };
    const delivered: Record<string, string>[] = [];
    const receipts: Array<{ envelope_id: string; received_at?: string }> = [];
    const sentReceipts: string[] = [];

    client.onMessage((envelope) => delivered.push(envelope));
    client.onReceipt((payload) => receipts.push(payload));
    privateClient.sendReceipt = async (envelopeId: string) => {
      sentReceipts.push(envelopeId);
      return { ok: true };
    };

    privateClient.handlePhoenix([
      '1',
      null,
      'relay:inbox',
      'message.deliver',
      { envelope_id: '01JDELIVER' },
    ]);
    privateClient.handlePhoenix([
      '1',
      null,
      'relay:inbox',
      'message.receipt',
      { envelope_id: '01JDELIVER', received_at: 'now' },
    ]);

    let rejected = '';
    privateClient.handlePhoenix(
      ['1', null, 'relay:inbox', 'phx_reply', { status: 'error', response: { code: 'bad' } }],
      undefined,
      (error) => {
        rejected = error.message;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(delivered).toEqual([{ envelope_id: '01JDELIVER' }]);
    expect(sentReceipts).toEqual(['01JDELIVER']);
    expect(receipts).toEqual([{ envelope_id: '01JDELIVER', received_at: 'now' }]);
    expect(rejected).toContain('error');
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition was not met');
}
