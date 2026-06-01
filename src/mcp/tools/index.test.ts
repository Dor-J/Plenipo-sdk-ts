import { describe, expect, it } from 'bun:test';
import { PlenipoClient } from '../../client/index.js';
import { createDidDocument } from '../../did/create.js';
import { createPlenipoMcpServer } from '../index.js';
import { registerPlenipoTools } from './index.js';

describe('createPlenipoMcpServer', () => {
  it('creates a server instance', () => {
    const server = createPlenipoMcpServer();
    expect(server).toBeDefined();
  });

  it('registers expected tool handlers', async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) {
        handlers.set(name, handler);
      },
    };

    registerPlenipoTools(fakeServer as never);

    expect([...handlers.keys()]).toEqual([
      'plenipo_send',
      'plenipo_receive',
      'plenipo_discover',
      'plenipo_balance',
      'plenipo_purchase_bundle',
      'plenipo_mandate_prepare',
      'plenipo_delivery_status',
      'plenipo_did_create',
    ]);

    const didCreate = await handlers.get('plenipo_did_create')?.({ domain: 'agent.local' });
    expect(JSON.stringify(didCreate)).toContain('did:web:agent.local');
  });

  it('executes HTTP-backed and runtime-backed tool handlers', async () => {
    const previousFetch = globalThis.fetch;
    const previousConnect = PlenipoClient.prototype.connect;
    const previousSend = PlenipoClient.prototype.send;
    const previousBalance = PlenipoClient.prototype.getBalance;
    const previousEnv = {
      did: process.env.PLENIPO_DID,
      auth: process.env.PLENIPO_AUTH_SECRET_B64,
      doc: process.env.PLENIPO_DID_DOCUMENT_URL,
      unsafe: process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH,
    };
    const recipient = await createDidDocument('recipient.local');
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) {
        handlers.set(name, handler);
      },
    };

    process.env.PLENIPO_DID = 'did:web:tool.local';
    process.env.PLENIPO_AUTH_SECRET_B64 = Buffer.alloc(32).toString('base64url');
    process.env.PLENIPO_DID_DOCUMENT_URL = 'https://tool.local/.well-known/did.json';
    process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = 'true';
    PlenipoClient.prototype.connect = async () => undefined;
    PlenipoClient.prototype.getBalance = async () => 77;
    PlenipoClient.prototype.send = async () => ({
      type: 'ack',
      v: '1.0',
      envelope_id: '01JTOOL',
      status: 'queued',
    });
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('/api/v1/search')) {
        return new Response(
          JSON.stringify({
            results: [{ did: recipient.did, document_url: 'https://recipient.local/.well-known/did.json' }],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/.well-known/did.json')) {
        return new Response(JSON.stringify(recipient.document), { status: 200 });
      }
      if (url.includes('/v1/bundles/purchase')) {
        return new Response(JSON.stringify({ tokens: 1000, balance: 1000 }), { status: 200 });
      }
      if (url.includes('/operator/prepare')) {
        return new Response(
          JSON.stringify({ mandate: { agent_did: 'did:web:tool.local' }, signing_input_base64: 'SIG' }),
          { status: 200 },
        );
      }
      if (url.includes('/v1/delivery/')) {
        return new Response(
          JSON.stringify({ type: 'delivery_status', v: '1.0', envelope_id: '01J', status: 'delivered' }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      registerPlenipoTools(fakeServer as never);

      await expect(
        handlers.get('plenipo_send')?.({
          recipientDid: recipient.did,
          recipientDocumentUrl: 'https://recipient.local/.well-known/did.json',
          message: 'hello',
        }),
      ).resolves.toBeDefined();
      await expect(handlers.get('plenipo_receive')?.({ limit: 10 })).resolves.toBeDefined();
      await expect(handlers.get('plenipo_balance')?.({})).resolves.toBeDefined();
      await expect(handlers.get('plenipo_discover')?.({ query: 'recipient' })).resolves.toBeDefined();
      await expect(
        handlers.get('plenipo_purchase_bundle')?.({
          agentDid: 'did:web:tool.local',
          bundleId: 'starter',
          relayUrl: 'https://relay.local',
        }),
      ).resolves.toBeDefined();
      await expect(
        handlers.get('plenipo_mandate_prepare')?.({
          agentDid: 'did:web:tool.local',
          operatorDid: 'did:web:operator.local',
          relayUrl: 'https://relay.local',
        }),
      ).resolves.toBeDefined();
      await expect(
        handlers.get('plenipo_delivery_status')?.({
          envelopeId: '01J',
          relayUrl: 'https://relay.local',
        }),
      ).resolves.toBeDefined();
    } finally {
      globalThis.fetch = previousFetch;
      PlenipoClient.prototype.connect = previousConnect;
      PlenipoClient.prototype.send = previousSend;
      PlenipoClient.prototype.getBalance = previousBalance;
      restoreEnv(previousEnv);
    }
  });
});

function restoreEnv(previous: Record<string, string | undefined>): void {
  const mapping = {
    did: 'PLENIPO_DID',
    auth: 'PLENIPO_AUTH_SECRET_B64',
    doc: 'PLENIPO_DID_DOCUMENT_URL',
    unsafe: 'PLENIPO_ALLOW_UNSAFE_DID_FETCH',
  } as const;

  for (const [source, target] of Object.entries(mapping)) {
    const value = previous[source];
    if (value === undefined) {
      delete process.env[target];
    } else {
      process.env[target] = value;
    }
  }
}
