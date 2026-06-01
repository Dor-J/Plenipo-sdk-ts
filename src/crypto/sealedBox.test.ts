import { describe, expect, test } from 'bun:test';
import nacl from 'tweetnacl';
import { openSealed, seal } from './sealedBox.js';

describe('sealed box', () => {
  test('round-trips plaintext with X25519 keys', () => {
    const recipient = nacl.box.keyPair();
    const plaintext = new TextEncoder().encode('private message');

    const ciphertext = seal(plaintext, recipient.publicKey);
    const opened = openSealed(ciphertext, recipient.secretKey);

    expect(new TextDecoder().decode(opened)).toBe('private message');
  });

  test('rejects the wrong recipient secret key', () => {
    const recipient = nacl.box.keyPair();
    const other = nacl.box.keyPair();
    const plaintext = new TextEncoder().encode('private message');
    const ciphertext = seal(plaintext, recipient.publicKey);

    expect(() => openSealed(ciphertext, other.secretKey)).toThrow('Failed to decrypt sealed box');
  });
});
