import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeStore } from '../runtime/store.js';
import {
  decryptPlaintext,
  encryptPlaintext,
  resolveSidecarStoreKey,
  SidecarStoreKeyError,
} from './inboxCrypto.js';

describe('inboxCrypto', () => {
  it('encrypts and decrypts plaintext', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plenipo-inbox-'));
    process.env.PLENIPO_HOME = dir;
    const key = resolveSidecarStoreKey();
    const encrypted = encryptPlaintext('hello durable inbox', key);
    expect(decryptPlaintext(encrypted.ciphertextB64, encrypted.nonceB64, key)).toBe(
      'hello durable inbox',
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not store raw plaintext in sqlite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plenipo-inbox-'));
    process.env.PLENIPO_HOME = dir;
    const store = new RuntimeStore();
    const key = resolveSidecarStoreKey();
    const plaintext = 'super-secret-local-plaintext';
    const encrypted = encryptPlaintext(plaintext, key);
    store.insertInboxMessage({
      envelopeId: '01TEST',
      senderDid: 'did:web:sender',
      recipientDid: 'did:web:recipient',
      receivedAt: '2026-06-09T00:00:00Z',
      plaintextCiphertext: encrypted.ciphertextB64,
      plaintextNonce: encrypted.nonceB64,
      plaintextAlg: 'nacl-secretbox-v1',
      metadata: {},
    });
    const dbBytes = readFileSync(join(dir, 'runtime.sqlite'));
    expect(dbBytes.includes(Buffer.from(plaintext))).toBe(false);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('raises when key missing but inbox rows exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plenipo-inbox-'));
    process.env.PLENIPO_HOME = dir;
    const store = new RuntimeStore();
    const key = resolveSidecarStoreKey();
    const encrypted = encryptPlaintext('secret', key);
    store.insertInboxMessage({
      envelopeId: '01TEST',
      senderDid: 'did:web:sender',
      recipientDid: 'did:web:recipient',
      receivedAt: '2026-06-09T00:00:00Z',
      plaintextCiphertext: encrypted.ciphertextB64,
      plaintextNonce: encrypted.nonceB64,
      plaintextAlg: 'nacl-secretbox-v1',
      metadata: {},
    });
    rmSync(join(dir, 'sidecar-store.key'));
    expect(() => resolveSidecarStoreKey({ generateIfMissing: false })).toThrow(
      SidecarStoreKeyError,
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
