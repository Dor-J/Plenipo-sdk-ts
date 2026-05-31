import WebSocket from 'ws';
import { decodeBase64Url, encodeBase64Url } from '../crypto/base64url.js';
import { sign } from '../crypto/ed25519.js';
import { buildSigningInput } from '../crypto/signingInput.js';
import { seal } from '../crypto/sealedBox.js';
import { buildRelayPayment } from '../payments/index.js';
import { buildReceipt } from '../delivery/index.js';
import * as ed from '@noble/ed25519';

export interface PlenipoClientOptions {
  did: string;
  authSecretKey: string;
  didDocumentUrl: string;
  relayUrl?: string;
  /** Send message.receipt automatically on message.deliver (default true). */
  autoReceipt?: boolean;
  /** Wire envelope version (default 0.4). */
  protocolVersion?: string;
}

export type SendAckStatus = 'delivered' | 'queued';

export interface SendAck {
  type: 'ack';
  v: string;
  envelope_id: string;
  status: SendAckStatus;
  queued_until?: string;
}

type MessageHandler = (envelope: Record<string, string>) => void;
type ReceiptHandler = (payload: { envelope_id: string; received_at?: string }) => void;

/**
 * Programmatic client for the Plenipo relay.
 */
export class PlenipoClient {
  readonly did: string;
  private readonly authSecret: Uint8Array;
  private readonly didDocumentUrl: string;
  private readonly relayWsUrl: string;
  readonly relayHttpUrl: string;
  private readonly autoReceipt: boolean;
  private readonly protocolVersion: string;
  private ws?: WebSocket;
  private joinRef = '1';
  private refCounter = 2;
  private handlers: MessageHandler[] = [];
  private receiptHandlers: ReceiptHandler[] = [];

  constructor(options: PlenipoClientOptions) {
    this.did = options.did;
    this.authSecret = Buffer.from(options.authSecretKey, 'base64url');
    this.didDocumentUrl = options.didDocumentUrl;
    this.autoReceipt = options.autoReceipt ?? true;
    this.protocolVersion = options.protocolVersion ?? '0.4';
    const relayUrl = options.relayUrl ?? 'ws://localhost:4000/agent/websocket';
    const parsed = new URL(relayUrl);
    this.relayWsUrl = relayUrl.includes('?') ? relayUrl : `${relayUrl}?vsn=2.0.0`;
    this.relayHttpUrl = `http://${parsed.host}`;
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  onReceipt(handler: ReceiptHandler): void {
    this.receiptHandlers.push(handler);
  }

  async connect(): Promise<void> {
    const challengeRes = await fetch(`${this.relayHttpUrl}/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: this.did }),
    });
    const challenge = (await challengeRes.json()) as { nonce: string };
    const nonceBytes = decodeBase64Url(challenge.nonce);
    const signature = await sign(nonceBytes, this.authSecret);

    const params = new URLSearchParams({
      did: this.did,
      nonce: challenge.nonce,
      signature,
      did_document_url: this.didDocumentUrl,
    });

    const wsUrl = `${this.relayWsUrl}${this.relayWsUrl.includes('?') ? '&' : '?'}${params}`;

    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.on('open', () => {
        this.sendPhoenix(this.joinRef, null, 'relay:inbox', 'phx_join', {});
      });
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as unknown[];
        this.handlePhoenix(msg, resolve, reject);
      });
      this.ws.on('error', reject);
    });
  }

  async send(
    recipientDid: string,
    plaintext: string,
    recipientEncPublicKey: Uint8Array,
  ): Promise<SendAck> {
    const ciphertext = seal(new TextEncoder().encode(plaintext), recipientEncPublicKey);
    const envelopeId = generateUlid();
    const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const envelope = {
      type: 'envelope',
      v: this.protocolVersion,
      envelope_id: envelopeId,
      sender_did: this.did,
      recipient_did: recipientDid,
      created_at: createdAt,
      ciphertext,
      content_type: 'application/json',
    };

    const signingInput = buildSigningInput(envelope);
    const signature = await sign(signingInput, this.authSecret);

    const ciphertextBytes = Buffer.from(ciphertext, 'base64url').length;
    const costTokens = Math.ceil(ciphertextBytes / 1024) || 0;
    const x402 = buildRelayPayment(this.did, costTokens, envelopeId);

    const ref = String(this.refCounter++);
    return this.requestReply<SendAck>(ref, 'message.send', {
      envelope: { ...envelope, signature },
      payment: { x402 },
    });
  }

  /** Sends a delivery receipt for a received envelope. */
  async sendReceipt(envelopeId: string): Promise<Record<string, unknown>> {
    const ref = String(this.refCounter++);
    return this.requestReply(ref, 'message.receipt', buildReceipt(envelopeId));
  }

  /** Queries delivery status via the relay channel. */
  async getDeliveryStatus(envelopeId: string): Promise<Record<string, unknown>> {
    const ref = String(this.refCounter++);
    return this.requestReply(ref, 'delivery.get', { envelope_id: envelopeId });
  }

  async getBalance(): Promise<number> {
    const ref = String(this.refCounter++);
    const payload = await this.requestReply<{ balance: number }>(ref, 'balance.get', {});
    return payload.balance;
  }

  private requestReply<T>(ref: string, event: string, payload: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const handler = (data: Buffer) => {
        const msg = JSON.parse(data.toString()) as unknown[];
        if (msg[1] === ref && msg[3] === 'phx_reply') {
          this.ws?.off('message', handler);
          const body = msg[4] as { status: string; response?: T };
          if (body.status === 'ok' && body.response) {
            resolve(body.response);
          } else {
            reject(new Error(JSON.stringify(body)));
          }
        }
      };
      this.ws?.on('message', handler);
      this.sendPhoenix(this.joinRef, ref, 'relay:inbox', event, payload);
    });
  }

  private sendPhoenix(
    joinRef: string,
    ref: string | null,
    topic: string,
    event: string,
    payload: unknown,
  ): void {
    const message = ref ? [joinRef, ref, topic, event, payload] : [joinRef, ref, topic, event, payload];
    this.ws?.send(JSON.stringify(message));
  }

  private handlePhoenix(
    msg: unknown[],
    resolveConnect?: () => void,
    rejectConnect?: (err: Error) => void,
  ): void {
    const event = msg[3] as string;
    const payload = msg[4] as Record<string, unknown>;

    if (event === 'phx_reply' && payload?.status === 'ok' && !payload?.response) {
      resolveConnect?.();
    }

    if (event === 'message.deliver' && payload) {
      const envelope = payload as Record<string, string>;
      for (const h of this.handlers) {
        h(envelope);
      }
      if (this.autoReceipt && envelope.envelope_id) {
        void this.sendReceipt(envelope.envelope_id);
      }
    }

    if (event === 'message.receipt' && payload) {
      for (const h of this.receiptHandlers) {
        h(payload as { envelope_id: string; received_at?: string });
      }
    }

    if (event === 'phx_reply' && payload?.status === 'error' && rejectConnect) {
      rejectConnect(new Error(JSON.stringify(payload)));
    }
  }
}

function generateUlid(): string {
  const t = Date.now().toString(36).toUpperCase().padStart(10, '0');
  const r = crypto.getRandomValues(new Uint8Array(10));
  const rand = Array.from(r, (b) => (b % 32).toString(32).toUpperCase()).join('');
  return (t + rand).slice(0, 26);
}

/** Generates a fresh Ed25519 keypair for tests. */
export async function generateKeypair(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  const secretKey = ed.utils.randomSecretKey();
  const publicKey = await ed.getPublicKeyAsync(secretKey);
  return { publicKey, secretKey };
}
