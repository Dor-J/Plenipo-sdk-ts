import { decodeBase64Url } from '../crypto/base64url.js';
import { openSealed } from '../crypto/sealedBox.js';
import { resolveEncPublicKey } from '../did/resolve.js';
import { PlenipoClient, type SendAck } from '../client/index.js';
import { ensureIdentity } from '../identity/provision.js';
import { declareRoute, defaultRouteServiceFields, routeFromDocument } from '../identity/route.js';
import type { AgentIdentity } from '../identity/store.js';
import { syncIdentityWithCore } from '../identity/sync.js';
import { cursorFromReceiptPayload } from './cursor.js';
import {
  type AgentEvent,
  ConnectEvent,
  DeliveryReceiptEvent,
  DisconnectEvent,
  ErrorEvent,
  EventQueue,
  MessageEvent,
} from './events.js';
import { loadRuntimeState, updateMessageCursor, updateReceiptCursor } from './state.js';
import {
  encryptPlaintext,
  PLAINTEXT_ALG,
  resolveSidecarStoreKey,
} from '../sidecar/inboxCrypto.js';
import { type OutboxRecord, type ReceiptRecord, RuntimeStore } from './store.js';

function generateUlid(): string {
  const t = Date.now().toString(36).toUpperCase().padStart(10, '0');
  const r = crypto.getRandomValues(new Uint8Array(10));
  const rand = Array.from(r, (b) => (b % 32).toString(32).toUpperCase()).join('');
  return (t + rand).slice(0, 26);
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function documentHasRoute(document: Record<string, unknown>): boolean {
  const services = Array.isArray(document.service) ? document.service : [];
  for (const service of services) {
    if (
      typeof service === 'object' &&
      service !== null &&
      (service as Record<string, unknown>).type === 'PlenipoAgent' &&
      (service as Record<string, unknown>).protocols
    ) {
      return true;
    }
  }
  return false;
}

function ackFromOutbox(row: OutboxRecord): SendAck {
  return {
    type: 'ack',
    v: '1.0',
    envelope_id: row.envelopeId,
    status: 'queued',
    ciphertext_bytes: row.ciphertextBytes ?? undefined,
    billable_kb: row.billableKb ?? undefined,
    charged_tokens: row.chargedTokens ?? undefined,
    balance_after: row.balanceAfter ?? undefined,
  };
}

function receiptEventFromPayload(
  payload: Record<string, unknown>,
  recovered: boolean,
): DeliveryReceiptEvent {
  return {
    type: 'delivery_receipt',
    envelopeId: String(payload.envelope_id ?? ''),
    senderDid: payload.sender_did ? String(payload.sender_did) : null,
    recipientDid: payload.recipient_did ? String(payload.recipient_did) : null,
    ciphertextBytes: optionalInt(payload.ciphertext_bytes),
    billableKb: optionalInt(payload.billable_kb),
    chargedTokens: optionalInt(payload.charged_tokens),
    balanceAfter: optionalInt(payload.balance_after),
    receivedAt: payload.received_at ? String(payload.received_at) : null,
    deliveredAt: payload.delivered_at ? String(payload.delivered_at) : null,
    recovered,
  };
}

/** Long-lived autonomous agent runtime with durable outbox and receipt recovery. Requires Bun. */
export class PlenipoAgentRuntime {
  readonly store: RuntimeStore;
  private identity: AgentIdentity | null = null;
  private client: PlenipoClient | null = null;
  private readonly eventsQueue = new EventQueue<AgentEvent>();
  private running = false;
  private reconnectTask: Promise<void> | null = null;
  private readonly seenReceiptIds = new Set<string>();
  private routeDeclared = false;

  constructor(store?: RuntimeStore) {
    this.store = store ?? new RuntimeStore();
  }

  async ensureReady(): Promise<AgentIdentity> {
    loadRuntimeState(this.store);
    const identity = await ensureIdentity();
    const [synced] = await syncIdentityWithCore(identity);
    this.identity = synced;

    if (!this.routeDeclared && !documentHasRoute(synced.document)) {
      const defaults = defaultRouteServiceFields();
      await declareRoute({
        protocols: defaults.protocols,
        capabilities: ['general', 'mcp'],
        payment: defaults.payment,
        limits: defaults.limits,
      });
      this.routeDeclared = true;
    }

    await this.connectClient();
    return synced;
  }

  async send(
    recipientDid: string,
    message: string,
    recipientDocumentUrl?: string | null,
    options?: { envelopeId?: string },
  ): Promise<SendAck> {
    const envelopeId = options?.envelopeId ?? generateUlid();
    const existing = this.store.getOutbox(envelopeId);
    if (existing && (existing.status === 'accepted' || existing.status === 'delivered')) {
      return ackFromOutbox(existing);
    }

    const client = await this.ensureClient();
    this.store.insertOutboxPending({
      envelopeId,
      recipientDid,
      recipientDocumentUrl: recipientDocumentUrl ?? null,
    });

    try {
      const encKey = await resolveEncPublicKey({
        recipientDid,
        recipientDocumentUrl: recipientDocumentUrl ?? undefined,
        registryUrl: this.identity?.registryUrl,
        relayHttpUrl: client.relayHttpUrl,
      });
      const ack = await client.send(recipientDid, message, encKey, { envelopeId });
      this.store.markOutboxAccepted(envelopeId, {
        ciphertextBytes: optionalInt(ack.ciphertext_bytes),
        billableKb: optionalInt(ack.billable_kb),
        chargedTokens: optionalInt(ack.charged_tokens),
        balanceAfter: optionalInt(ack.balance_after),
      });
      return ack;
    } catch (error) {
      this.store.markOutboxFailed(envelopeId, String(error));
      throw error;
    }
  }

  async listReceipts(options?: {
    since?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    const client = await this.ensureClient();
    const result = await client.listReceipts(options);
    return (result.receipts ?? []) as unknown as Record<string, unknown>[];
  }

  outbox(options?: { status?: string; limit?: number }): OutboxRecord[] {
    return this.store.listOutbox(options);
  }

  receipts(limit = 100): ReceiptRecord[] {
    return this.store.listReceipts(limit);
  }

  async *events(): AsyncGenerator<AgentEvent> {
    while (true) {
      yield await this.eventsQueue.next();
    }
  }

  getIdentity(): AgentIdentity | null {
    return this.identity;
  }

  /** Reloads identity from disk after route or capability updates. */
  async reloadIdentity(): Promise<AgentIdentity> {
    const identity = await ensureIdentity();
    const [synced] = await syncIdentityWithCore(identity);
    this.identity = synced;
    return synced;
  }

  /** Marks route declared and refreshes identity after sidecar startup. */
  async afterRouteDeclared(): Promise<AgentIdentity> {
    this.routeDeclared = true;
    return this.reloadIdentity();
  }

  getClient(): PlenipoClient | null {
    return this.client;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
  }

  async close(): Promise<void> {
    this.running = false;
    await this.disconnect();
    this.store.close();
  }

  async runWithReconnect(): Promise<void> {
    await this.ensureReady();
    this.running = true;
    this.reconnectTask = this.maintainConnection();
  }

  private async ensureClient(): Promise<PlenipoClient> {
    if (!this.client || !this.client.connected) {
      await this.connectClient();
    }
    if (!this.client) {
      throw new Error('Failed to connect relay client');
    }
    return this.client;
  }

  private async connectClient(): Promise<void> {
    if (!this.identity) {
      this.identity = await ensureIdentity();
    }
    if (this.client) {
      await this.client.disconnect();
    }

    const client = new PlenipoClient({
      did: this.identity.did,
      authSecretKey: this.identity.authSecretB64,
      didDocumentUrl: this.identity.didDocumentUrl,
      relayUrl: this.identity.relayUrl,
      autoReceipt: true,
    });
    const encSecret = this.identity.encSecretB64;

    client.onMessage((envelope) => {
      let plaintext: string | null = null;
      if (encSecret && envelope.ciphertext) {
        try {
          const secretKey = decodeBase64Url(encSecret);
          const plain = openSealed(envelope.ciphertext, secretKey);
          plaintext = new TextDecoder().decode(plain);
        } catch {
          plaintext = null;
        }
      }
      this.observeMessage(envelope as Record<string, unknown>, plaintext);
    });

    client.onReceipt((payload) => {
      this.observeReceipt(payload as unknown as Record<string, unknown>, false);
    });

    await client.connect();
    this.client = client;
    await this.recoverMissedReceipts();
    this.eventsQueue.push({ type: 'connect', did: this.identity.did } satisfies ConnectEvent);
  }

  private observeMessage(
    envelope: Record<string, unknown>,
    plaintext: string | null,
  ): void {
    const envelopeId = String(envelope.envelope_id ?? '');
    if (!envelopeId) {
      return;
    }

    const receivedAt = envelope.created_at
      ? String(envelope.created_at)
      : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const senderDid = String(envelope.sender_did ?? '');
    const recipientDid = String(envelope.recipient_did ?? '');

    if (plaintext !== null && !this.store.hasSidecarEvent(envelopeId, 'message')) {
      const storeKey = resolveSidecarStoreKey();
      const encrypted = encryptPlaintext(plaintext, storeKey);
      this.store.insertInboxMessage({
        envelopeId,
        senderDid,
        recipientDid,
        receivedAt,
        plaintextCiphertext: encrypted.ciphertextB64,
        plaintextNonce: encrypted.nonceB64,
        plaintextAlg: PLAINTEXT_ALG,
        metadata: { created_at: envelope.created_at ?? null },
      });
      this.store.insertSidecarEvent({
        eventType: 'message',
        envelopeId,
        payload: {
          type: 'message',
          envelope_id: envelopeId,
          sender_did: senderDid,
          recipient_did: recipientDid,
          received_at: receivedAt,
          plaintext_ref: `inbox:${envelopeId}`,
        },
      });
      updateMessageCursor({ receivedAt, envelopeId, store: this.store });
    }

    this.eventsQueue.push({
      type: 'message',
      envelopeId,
      senderDid,
      recipientDid,
      plaintext,
      createdAt: envelope.created_at ? String(envelope.created_at) : null,
    } satisfies MessageEvent);
  }

  private observeReceipt(payload: Record<string, unknown>, recovered: boolean): void {
    const envelopeId = String(payload.envelope_id ?? '');
    if (!envelopeId) {
      return;
    }

    const senderDid = this.identity?.did ?? String(payload.sender_did ?? '');
    if (this.store.hasReceipt(envelopeId)) {
      this.seenReceiptIds.add(envelopeId);
      return;
    }

    const isNew = this.store.upsertReceipt(payload, senderDid);
    if (!isNew) {
      return;
    }

    this.seenReceiptIds.add(envelopeId);
    this.store.markOutboxDelivered(
      envelopeId,
      payload.delivered_at ? String(payload.delivered_at) : payload.received_at ? String(payload.received_at) : null,
    );
    if (!this.store.hasSidecarEvent(envelopeId, 'delivery_receipt')) {
      const receiptPayload: Record<string, unknown> = {
        type: 'delivery_receipt',
        envelope_id: envelopeId,
        charged_tokens: optionalInt(payload.charged_tokens),
      };
      const deliveredAt = payload.delivered_at ?? payload.received_at;
      if (deliveredAt) {
        receiptPayload.delivered_at = String(deliveredAt);
      }
      if (payload.ciphertext_bytes !== undefined) {
        receiptPayload.ciphertext_bytes = optionalInt(payload.ciphertext_bytes);
      }
      if (payload.billable_kb !== undefined) {
        receiptPayload.billable_kb = optionalInt(payload.billable_kb);
      }
      if (payload.balance_after !== undefined) {
        receiptPayload.balance_after = optionalInt(payload.balance_after);
      }
      this.store.insertSidecarEvent({
        eventType: 'delivery_receipt',
        envelopeId,
        payload: receiptPayload,
      });
    }
    const event = receiptEventFromPayload(payload, recovered);
    this.eventsQueue.push(event);
    updateReceiptCursor({
      deliveredAt: event.deliveredAt,
      receivedAt: event.receivedAt,
      cursor: cursorFromReceiptPayload(payload),
      store: this.store,
    });
  }

  private async recoverMissedReceipts(): Promise<void> {
    if (!this.client || !this.identity) {
      return;
    }

    let pageCursor = this.store.getState('last_receipt_cursor');
    const state = loadRuntimeState(this.store);
    let since = pageCursor ? undefined : state.lastReceiptSeenAt ?? undefined;

    while (true) {
      const result = await this.client.listReceipts({
        cursor: pageCursor ?? undefined,
        since,
        limit: 100,
      });
      const receipts = result.receipts ?? [];
      for (const payload of receipts) {
        this.observeReceipt(payload as unknown as Record<string, unknown>, true);
      }

      const nextCursor = result.next_cursor;
      if (!receipts.length || !nextCursor) {
        if (receipts.length) {
          const last = receipts[receipts.length - 1] as unknown as Record<string, unknown>;
          const finalCursor = cursorFromReceiptPayload(last);
          if (finalCursor) {
            this.store.setState('last_receipt_cursor', finalCursor);
          }
        }
        break;
      }
      pageCursor = String(nextCursor);
      since = undefined;
    }
  }

  private async maintainConnection(): Promise<void> {
    let backoff = 1.0;
    while (this.running) {
      await sleep(1000);
      if (!this.client || !this.client.connected) {
        this.eventsQueue.push({ type: 'disconnect', reason: 'relay disconnected' } satisfies DisconnectEvent);
        try {
          await this.connectClient();
          backoff = 1.0;
        } catch (error) {
          this.eventsQueue.push({ type: 'error', message: String(error) } satisfies ErrorEvent);
          await sleep(backoff * 1000);
          backoff = Math.min(backoff * 2, 30);
        }
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
