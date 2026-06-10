import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { plenipoHome } from '../identity/store.js';

export const RUNTIME_SCHEMA_VERSION = 1;

export interface OutboxRecord {
  envelopeId: string;
  recipientDid: string;
  recipientDocumentUrl: string | null;
  createdAt: string;
  status: string;
  ciphertextBytes: number | null;
  billableKb: number | null;
  chargedTokens: number | null;
  balanceAfter: number | null;
  sentAt: string | null;
  deliveredAt: string | null;
  lastError: string | null;
}

export interface ReceiptRecord {
  envelopeId: string;
  senderDid: string;
  recipientDid: string;
  ciphertextBytes: number | null;
  billableKb: number | null;
  chargedTokens: number | null;
  balanceAfter: number | null;
  receivedAt: string | null;
  deliveredAt: string | null;
}

export interface SidecarEventRecord {
  id: number;
  eventType: string;
  envelopeId: string | null;
  createdAt: string;
  payloadJson: string;
  deliveredToClientAt: string | null;
}

export interface InboxMessageRecord {
  envelopeId: string;
  senderDid: string;
  recipientDid: string;
  receivedAt: string;
  plaintextCiphertext: string;
  plaintextNonce: string;
  plaintextAlg: string;
  metadataJson: string;
}

/** Returns the path to runtime.sqlite. */
export function runtimeDbPath(): string {
  return join(plenipoHome(), 'runtime.sqlite');
}

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

/** Local SQLite store for outbox, receipts, and runtime cursors. Requires Bun. */
export class RuntimeStore {
  private readonly db: Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? runtimeDbPath();
    if (path !== ':memory:') {
      mkdirSync(plenipoHome(), { recursive: true });
    }
    this.db = new Database(path, { create: true });
    this.initSchema();
  }

  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    const existingVersion = this.schemaVersion();
    if (existingVersion > RUNTIME_SCHEMA_VERSION) {
      throw new Error(
        `Runtime database schema version ${existingVersion} is newer than this SDK supports (${RUNTIME_SCHEMA_VERSION})`,
      );
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS outbox (
        envelope_id TEXT PRIMARY KEY,
        recipient_did TEXT NOT NULL,
        recipient_document_url TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        ciphertext_bytes INTEGER,
        billable_kb INTEGER,
        charged_tokens INTEGER,
        balance_after INTEGER,
        sent_at TEXT,
        delivered_at TEXT,
        last_error TEXT
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS receipts (
        envelope_id TEXT PRIMARY KEY,
        sender_did TEXT NOT NULL,
        recipient_did TEXT NOT NULL,
        ciphertext_bytes INTEGER,
        billable_kb INTEGER,
        charged_tokens INTEGER,
        balance_after INTEGER,
        received_at TEXT,
        delivered_at TEXT,
        raw_json TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS runtime_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sidecar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        envelope_id TEXT,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        delivered_to_client_at TEXT
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sidecar_events_id ON sidecar_events(id)`);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_sidecar_events_envelope
      ON sidecar_events(envelope_id, event_type)
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        envelope_id TEXT PRIMARY KEY,
        sender_did TEXT NOT NULL,
        recipient_did TEXT NOT NULL,
        received_at TEXT NOT NULL,
        plaintext_ciphertext TEXT NOT NULL,
        plaintext_nonce TEXT NOT NULL,
        plaintext_alg TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      )
    `);
    if (existingVersion < RUNTIME_SCHEMA_VERSION) {
      this.db.run(`PRAGMA user_version = ${RUNTIME_SCHEMA_VERSION}`);
    }
  }

  schemaVersion(): number {
    const row = this.db.query('PRAGMA user_version').get() as { user_version: number } | null;
    return Number(row?.user_version ?? 0);
  }

  getState(key: string): string | null {
    const row = this.db.query('SELECT value FROM runtime_state WHERE key = ?').get(key) as
      | { value: string }
      | null;
    return row?.value ?? null;
  }

  setState(key: string, value: string): void {
    this.db.run(
      'INSERT INTO runtime_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  getOutbox(envelopeId: string): OutboxRecord | null {
    const row = this.db.query('SELECT * FROM outbox WHERE envelope_id = ?').get(envelopeId) as
      | Record<string, unknown>
      | null;
    return row ? rowToOutbox(row) : null;
  }

  insertOutboxPending(input: {
    envelopeId: string;
    recipientDid: string;
    recipientDocumentUrl?: string | null;
  }): void {
    this.db.run(
      `INSERT INTO outbox (envelope_id, recipient_did, recipient_document_url, created_at, status)
       VALUES (?, ?, ?, ?, 'pending') ON CONFLICT(envelope_id) DO NOTHING`,
      [input.envelopeId, input.recipientDid, input.recipientDocumentUrl ?? null, utcNowIso()],
    );
  }

  markOutboxAccepted(
    envelopeId: string,
    billing: {
      ciphertextBytes: number | null;
      billableKb: number | null;
      chargedTokens: number | null;
      balanceAfter: number | null;
    },
  ): void {
    this.db.run(
      `UPDATE outbox SET status = 'accepted', ciphertext_bytes = ?, billable_kb = ?,
       charged_tokens = ?, balance_after = ?, sent_at = ?, last_error = NULL
       WHERE envelope_id = ?`,
      [
        billing.ciphertextBytes,
        billing.billableKb,
        billing.chargedTokens,
        billing.balanceAfter,
        utcNowIso(),
        envelopeId,
      ],
    );
  }

  markOutboxFailed(envelopeId: string, lastError: string): void {
    this.db.run(`UPDATE outbox SET status = 'failed', last_error = ? WHERE envelope_id = ?`, [
      lastError.slice(0, 500),
      envelopeId,
    ]);
  }

  markOutboxDelivered(envelopeId: string, deliveredAt?: string | null): void {
    this.db.run(`UPDATE outbox SET status = 'delivered', delivered_at = ? WHERE envelope_id = ?`, [
      deliveredAt ?? utcNowIso(),
      envelopeId,
    ]);
  }

  listOutbox(options?: { status?: string; limit?: number }): OutboxRecord[] {
    const limit = options?.limit ?? 100;
    const rows = options?.status
      ? this.db
          .query('SELECT * FROM outbox WHERE status = ? ORDER BY created_at DESC LIMIT ?')
          .all(options.status, limit)
      : this.db.query('SELECT * FROM outbox ORDER BY created_at DESC LIMIT ?').all(limit);
    return (rows as Record<string, unknown>[]).map(rowToOutbox);
  }

  countOutboxByStatus(): Record<string, number> {
    const rows = this.db
      .query('SELECT status, COUNT(*) AS count FROM outbox GROUP BY status')
      .all() as Array<{ status: string; count: number }>;
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  countReceipts(): number {
    const row = this.db.query('SELECT COUNT(*) AS count FROM receipts').get() as
      | { count: number }
      | null;
    return Number(row?.count ?? 0);
  }

  upsertReceipt(payload: Record<string, unknown>, senderDid: string): boolean {
    const envelopeId = String(payload.envelope_id ?? '');
    if (!envelopeId) {
      return false;
    }
    const existing = this.db
      .query('SELECT envelope_id FROM receipts WHERE envelope_id = ?')
      .get(envelopeId);
    if (existing) {
      return false;
    }
    this.db.run(
      `INSERT INTO receipts (
        envelope_id, sender_did, recipient_did, ciphertext_bytes, billable_kb,
        charged_tokens, balance_after, received_at, delivered_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        envelopeId,
        senderDid,
        String(payload.recipient_did ?? ''),
        optionalInt(payload.ciphertext_bytes),
        optionalInt(payload.billable_kb),
        optionalInt(payload.charged_tokens),
        optionalInt(payload.balance_after),
        payload.received_at != null ? String(payload.received_at) : null,
        payload.delivered_at != null ? String(payload.delivered_at) : null,
        JSON.stringify(payload),
      ],
    );
    return true;
  }

  hasReceipt(envelopeId: string): boolean {
    const row = this.db
      .query('SELECT envelope_id FROM receipts WHERE envelope_id = ?')
      .get(envelopeId);
    return row !== null && row !== undefined;
  }

  listReceipts(limit = 100): ReceiptRecord[] {
    const rows = this.db
      .query('SELECT * FROM receipts ORDER BY delivered_at DESC, envelope_id DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToReceipt);
  }

  migrateLegacyJsonState(lastReceiptSeenAt: string | null): void {
    if (lastReceiptSeenAt && !this.getState('last_receipt_seen_at')) {
      this.setState('last_receipt_seen_at', lastReceiptSeenAt);
    }
  }

  insertSidecarEvent(input: {
    eventType: string;
    envelopeId: string | null;
    payload: Record<string, unknown>;
  }): number {
    const result = this.db.run(
      `INSERT INTO sidecar_events (event_type, envelope_id, created_at, payload_json)
       VALUES (?, ?, ?, ?)`,
      [input.eventType, input.envelopeId, utcNowIso(), JSON.stringify(input.payload)],
    );
    return Number(result.lastInsertRowid);
  }

  hasSidecarEvent(envelopeId: string, eventType: string): boolean {
    const row = this.db
      .query(
        `SELECT id FROM sidecar_events WHERE envelope_id = ? AND event_type = ?`,
      )
      .get(envelopeId, eventType);
    return row !== null && row !== undefined;
  }

  listSidecarEvents(afterId = 0, limit = 100): SidecarEventRecord[] {
    const rows = this.db
      .query(
        `SELECT * FROM sidecar_events WHERE id > ? ORDER BY id ASC LIMIT ?`,
      )
      .all(afterId, limit) as Record<string, unknown>[];
    return rows.map(rowToSidecarEvent);
  }

  markSidecarEventDelivered(eventId: number): void {
    this.db.run(
      `UPDATE sidecar_events SET delivered_to_client_at = ? WHERE id = ?`,
      [utcNowIso(), eventId],
    );
  }

  countInboxMessages(): number {
    const row = this.db.query(`SELECT COUNT(*) AS count FROM inbox_messages`).get() as
      | { count: number }
      | null;
    return Number(row?.count ?? 0);
  }

  countSidecarEventsByType(): Record<string, number> {
    const rows = this.db
      .query('SELECT event_type, COUNT(*) AS count FROM sidecar_events GROUP BY event_type')
      .all() as Array<{ event_type: string; count: number }>;
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.event_type] = Number(row.count);
    }
    return counts;
  }

  countPendingSidecarEvents(): number {
    const row = this.db
      .query('SELECT COUNT(*) AS count FROM sidecar_events WHERE delivered_to_client_at IS NULL')
      .get() as { count: number } | null;
    return Number(row?.count ?? 0);
  }

  insertInboxMessage(input: {
    envelopeId: string;
    senderDid: string;
    recipientDid: string;
    receivedAt: string;
    plaintextCiphertext: string;
    plaintextNonce: string;
    plaintextAlg: string;
    metadata: Record<string, unknown>;
  }): boolean {
    const existing = this.db
      .query(`SELECT envelope_id FROM inbox_messages WHERE envelope_id = ?`)
      .get(input.envelopeId);
    if (existing) {
      return false;
    }
    this.db.run(
      `INSERT INTO inbox_messages (
        envelope_id, sender_did, recipient_did, received_at,
        plaintext_ciphertext, plaintext_nonce, plaintext_alg, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.envelopeId,
        input.senderDid,
        input.recipientDid,
        input.receivedAt,
        input.plaintextCiphertext,
        input.plaintextNonce,
        input.plaintextAlg,
        JSON.stringify(input.metadata),
      ],
    );
    return true;
  }

  getInboxMessage(envelopeId: string): InboxMessageRecord | null {
    const row = this.db
      .query(`SELECT * FROM inbox_messages WHERE envelope_id = ?`)
      .get(envelopeId) as Record<string, unknown> | null;
    return row ? rowToInbox(row) : null;
  }

  listInbox(limit = 100): InboxMessageRecord[] {
    const rows = this.db
      .query(`SELECT * FROM inbox_messages ORDER BY received_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToInbox);
  }
}

function rowToOutbox(row: Record<string, unknown>): OutboxRecord {
  return {
    envelopeId: String(row.envelope_id),
    recipientDid: String(row.recipient_did),
    recipientDocumentUrl: row.recipient_document_url ? String(row.recipient_document_url) : null,
    createdAt: String(row.created_at),
    status: String(row.status),
    ciphertextBytes: optionalInt(row.ciphertext_bytes),
    billableKb: optionalInt(row.billable_kb),
    chargedTokens: optionalInt(row.charged_tokens),
    balanceAfter: optionalInt(row.balance_after),
    sentAt: row.sent_at ? String(row.sent_at) : null,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

function rowToReceipt(row: Record<string, unknown>): ReceiptRecord {
  return {
    envelopeId: String(row.envelope_id),
    senderDid: String(row.sender_did),
    recipientDid: String(row.recipient_did),
    ciphertextBytes: optionalInt(row.ciphertext_bytes),
    billableKb: optionalInt(row.billable_kb),
    chargedTokens: optionalInt(row.charged_tokens),
    balanceAfter: optionalInt(row.balance_after),
    receivedAt: row.received_at ? String(row.received_at) : null,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
  };
}

function rowToSidecarEvent(row: Record<string, unknown>): SidecarEventRecord {
  return {
    id: Number(row.id),
    eventType: String(row.event_type),
    envelopeId: row.envelope_id ? String(row.envelope_id) : null,
    createdAt: String(row.created_at),
    payloadJson: String(row.payload_json),
    deliveredToClientAt: row.delivered_to_client_at
      ? String(row.delivered_to_client_at)
      : null,
  };
}

function rowToInbox(row: Record<string, unknown>): InboxMessageRecord {
  return {
    envelopeId: String(row.envelope_id),
    senderDid: String(row.sender_did),
    recipientDid: String(row.recipient_did),
    receivedAt: String(row.received_at),
    plaintextCiphertext: String(row.plaintext_ciphertext),
    plaintextNonce: String(row.plaintext_nonce),
    plaintextAlg: String(row.plaintext_alg),
    metadataJson: String(row.metadata_json),
  };
}

/** Loads legacy runtime-state.json if present. */
export function loadLegacyRuntimeState(): {
  lastReceiptSeenAt: string | null;
  lastReceiptCursor: string | null;
  lastMessageSeenAt: string | null;
} | null {
  const path = join(plenipoHome(), 'runtime-state.json');
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return {
      lastReceiptSeenAt: raw.last_receipt_seen_at ? String(raw.last_receipt_seen_at) : null,
      lastReceiptCursor: raw.last_receipt_cursor ? String(raw.last_receipt_cursor) : null,
      lastMessageSeenAt: raw.last_message_seen_at ? String(raw.last_message_seen_at) : null,
    };
  } catch {
    return null;
  }
}
