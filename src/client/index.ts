import WebSocket from 'ws';
import { decodeBase64Url, encodeBase64Url } from '../crypto/base64url.js';
import { sign } from '../crypto/ed25519.js';
import { buildSigningInput } from '../crypto/signingInput.js';
import { seal } from '../crypto/sealedBox.js';
import { buildRelayPayment } from '../payments/index.js';
import { buildReceipt, type DeliveryReceiptRecord, type ReceiptListResponse } from '../delivery/index.js';
import * as ed from '@noble/ed25519';

export interface PlenipoClientOptions {
  did: string;
  authSecretKey: string;
  didDocumentUrl: string;
  relayUrl?: string;
  /** Send message.receipt automatically on message.deliver (default true). */
  autoReceipt?: boolean;
  /** Wire envelope version (default 1.0). */
  protocolVersion?: string;
}

export type SendAckStatus = 'delivered' | 'queued';

export interface SendAck {
  type: 'ack';
  v: string;
  envelope_id: string;
  status: SendAckStatus;
  queued_until?: string;
  bytes?: number;
  balance?: number;
  ciphertext_bytes?: number;
  billable_kb?: number;
  charged_tokens?: number;
  balance_after?: number;
}

type MessageHandler = (envelope: Record<string, string>) => void;
export type ReceiptHandler = (payload: DeliveryReceiptRecord) => void;

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
    this.protocolVersion = options.protocolVersion ?? '1.0';
    const relayUrl = options.relayUrl ?? 'ws://localhost:4000/agent/websocket';
    const parsed = new URL(relayUrl);
    ensureAllowedRelayScheme(parsed);
    this.relayWsUrl = relayUrl.includes('?') ? relayUrl : `${relayUrl}?vsn=2.0.0`;
    this.relayHttpUrl = relayHttpOrigin(parsed);
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
      this.ws.on('error', (err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  async send(
    recipientDid: string,
    plaintext: string,
    recipientEncPublicKey: Uint8Array,
    options?: { envelopeId?: string },
  ): Promise<SendAck> {
    const ciphertext = seal(new TextEncoder().encode(plaintext), recipientEncPublicKey);
    const envelopeId = options?.envelopeId ?? generateUlid();
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

  /** Lists persisted delivery receipts for the authenticated sender. */
  async listReceipts(options?: {
    since?: string;
    cursor?: string;
    limit?: number;
  }): Promise<ReceiptListResponse> {
    const ref = String(this.refCounter++);
    const payload: Record<string, unknown> = { limit: options?.limit ?? 100 };
    if (options?.cursor) {
      payload.cursor = options.cursor;
    } else if (options?.since) {
      payload.since = options.since;
    }
    return this.requestReply<ReceiptListResponse>(ref, 'receipt.list', payload);
  }

  /** Returns true when the relay websocket is open. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Closes the relay websocket connection. */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
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
    const message = [joinRef, ref, topic, event, payload];
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
        h(payload as unknown as DeliveryReceiptRecord);
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
  const secretKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(secretKey);
  return { publicKey, secretKey };
}

function relayHttpOrigin(parsed: URL): string {
  if (parsed.protocol === 'wss:') {
    return `https://${parsed.host}`;
  }

  if (parsed.protocol === 'ws:') {
    return `http://${parsed.host}`;
  }

  throw new Error('relayUrl must use ws:// or wss://');
}

function ensureAllowedRelayScheme(parsed: URL): void {
  if (parsed.protocol === 'wss:') {
    return;
  }

  if (parsed.protocol !== 'ws:') {
    throw new Error('relayUrl must use ws:// or wss://');
  }

  if (isLocalRelayHost(parsed.hostname) || process.env.PLENIPO_ALLOW_INSECURE_RELAY === 'true') {
    return;
  }

  throw new Error('Insecure ws:// relayUrl is allowed only for localhost or explicit opt-in');
}

function isLocalRelayHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
