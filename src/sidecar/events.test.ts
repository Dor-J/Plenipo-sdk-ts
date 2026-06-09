import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeStore } from '../runtime/store.js';
import { DurableEventService } from './events.js';
import { encryptPlaintext, resolveSidecarStoreKey } from './inboxCrypto.js';
import { sidecarEventToApiDict } from './models.js';

describe('DurableEventService', () => {
  it('lists events after cursor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plenipo-events-'));
    process.env.PLENIPO_HOME = dir;
    const store = new RuntimeStore();
    const first = store.insertSidecarEvent({
      eventType: 'delivery_receipt',
      envelopeId: '01A',
      payload: { type: 'delivery_receipt', envelope_id: '01A', charged_tokens: 1 },
    });
    store.insertSidecarEvent({
      eventType: 'delivery_receipt',
      envelopeId: '01B',
      payload: { type: 'delivery_receipt', envelope_id: '01B', charged_tokens: 2 },
    });
    const rows = store.listSidecarEvents(first, 10);
    expect(rows).toHaveLength(1);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns metadata only when includePlaintext is false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plenipo-events-'));
    process.env.PLENIPO_HOME = dir;
    const store = new RuntimeStore();
    const key = resolveSidecarStoreKey();
    const encrypted = encryptPlaintext('hello', key);
    store.insertInboxMessage({
      envelopeId: '01MSG',
      senderDid: 'did:web:sender',
      recipientDid: 'did:web:recipient',
      receivedAt: '2026-06-09T00:00:00Z',
      plaintextCiphertext: encrypted.ciphertextB64,
      plaintextNonce: encrypted.nonceB64,
      plaintextAlg: 'nacl-secretbox-v1',
      metadata: {},
    });
    const eventId = store.insertSidecarEvent({
      eventType: 'message',
      envelopeId: '01MSG',
      payload: {
        type: 'message',
        envelope_id: '01MSG',
        sender_did: 'did:web:sender',
        recipient_did: 'did:web:recipient',
        received_at: '2026-06-09T00:00:00Z',
        plaintext_ref: 'inbox:01MSG',
      },
    });
    const row = store.listSidecarEvents(eventId - 1, 1)[0];
    const meta = sidecarEventToApiDict(row!, { store, includePlaintext: false });
    expect(meta.has_plaintext).toBe(true);
    expect(meta.plaintext).toBeUndefined();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('long-poll times out with no events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plenipo-events-'));
    process.env.PLENIPO_HOME = dir;
    const store = new RuntimeStore();
    const service = new DurableEventService(store);
    const result = await service.waitForEvents({
      afterId: 0,
      timeoutMs: 100,
      limit: 10,
      includePlaintext: false,
    });
    expect(result.events).toHaveLength(0);
    expect(result.nextAfterId).toBe(0);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
