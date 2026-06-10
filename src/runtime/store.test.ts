import { describe, expect, it } from 'bun:test';
import { RuntimeStore } from './store.js';

describe('RuntimeStore', () => {
  it('persists outbox and receipt rows', () => {
    const store = new RuntimeStore(':memory:');
    store.insertOutboxPending({
      envelopeId: '01TESTENVELOPE00000001',
      recipientDid: 'did:web:recipient.local',
      recipientDocumentUrl: null,
    });
    store.markOutboxAccepted('01TESTENVELOPE00000001', {
      ciphertextBytes: 100,
      billableKb: 1,
      chargedTokens: 1,
      balanceAfter: 99,
    });
    const outbox = store.listOutbox({ limit: 10 });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.status).toBe('accepted');

    const isNew = store.upsertReceipt(
      {
        envelope_id: '01TESTENVELOPE00000001',
        sender_did: 'did:web:sender.local',
        recipient_did: 'did:web:recipient.local',
        charged_tokens: 1,
        ciphertext_bytes: 100,
      },
      'did:web:sender.local',
    );
    expect(isNew).toBe(true);
    expect(store.hasReceipt('01TESTENVELOPE00000001')).toBe(true);
    store.close();
  });

  it('tracks runtime cursor state', () => {
    const store = new RuntimeStore(':memory:');
    store.setState('last_receipt_cursor', 'cursor-1');
    expect(store.getState('last_receipt_cursor')).toBe('cursor-1');
    store.close();
  });

  it('sets SQLite user_version for runtime migrations', () => {
    const store = new RuntimeStore(':memory:');
    expect(store.schemaVersion()).toBe(1);
    store.close();
  });
});
