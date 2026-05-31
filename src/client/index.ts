import WebSocket from 'ws';
import { decodeBase64Url, encodeBase64Url } from '../crypto/base64url.js';
import { sign } from '../crypto/ed25519.js';
import { buildSigningInput } from '../crypto/signingInput.js';
import { seal } from '../crypto/sealedBox.js';
import * as ed from '@noble/ed25519';

export interface PlenipoClientOptions {
  did: string;
  authSecretKey: string;
  didDocumentUrl: string;
  relayUrl?: string;
}

type MessageHandler = (envelope: Record<string, string>) => void;

/**
 * Programmatic client for the Plenipo relay.
 */
export class PlenipoClient {
  readonly did: string;
  private readonly authSecret: Uint8Array;
  private readonly didDocumentUrl: string;
  private readonly relayWsUrl: string;
  private readonly relayHttpUrl: string;
  private ws?: WebSocket;
  private joinRef = '1';
  private refCounter = 2;
  private handlers: MessageHandler[] = [];

  constructor(options: PlenipoClientOptions) {
    this.did = options.did;
    this.authSecret = Buffer.from(options.authSecretKey, 'base64url');
    this.didDocumentUrl = options.didDocumentUrl;
    const relayUrl = options.relayUrl ?? 'ws://localhost:4000/agent/websocket';
    const parsed = new URL(relayUrl);
    this.relayWsUrl = relayUrl.includes('?') ? relayUrl : `${relayUrl}?vsn=2.0.0`;
    this.relayHttpUrl = `http://${parsed.host}`;
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
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

  async send(recipientDid: string, plaintext: string, recipientEncPublicKey: Uint8Array): Promise<void> {
    const ciphertext = seal(new TextEncoder().encode(plaintext), recipientEncPublicKey);
    const envelopeId = generateUlid();
    const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const envelope = {
      type: 'envelope',
      v: '0.2',
      envelope_id: envelopeId,
      sender_did: this.did,
      recipient_did: recipientDid,
      created_at: createdAt,
      ciphertext,
      content_type: 'application/json',
    };

    const signingInput = buildSigningInput(envelope);
    const signature = await sign(signingInput, this.authSecret);

    this.sendPhoenix(this.joinRef, String(this.refCounter++), 'relay:inbox', 'message.send', {
      ...envelope,
      signature,
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
    resolveConnect: () => void,
    rejectConnect: (err: Error) => void,
  ): void {
    const event = msg[3] as string;
    const payload = msg[4] as Record<string, unknown>;

    if (event === 'phx_reply' && payload?.status === 'ok' && !payload?.response) {
      resolveConnect();
    }

    if (event === 'message.deliver' && payload) {
      for (const h of this.handlers) {
        h(payload as Record<string, string>);
      }
    }

    if (event === 'phx_reply' && payload?.status === 'error') {
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
