import nacl from 'tweetnacl';
import { decodeBase64Url, encodeBase64Url } from './base64url.js';

/** Seals plaintext to recipient X25519 public key (libsodium crypto_box_seal). */
export function seal(plaintext: Uint8Array, recipientPublicKey: Uint8Array): string {
  const sealed = nacl.sealedbox.seal(plaintext, recipientPublicKey);
  return encodeBase64Url(sealed);
}

/** Opens sealed ciphertext with recipient X25519 secret key. */
export function openSealed(ciphertextB64: string, recipientSecretKey: Uint8Array): Uint8Array {
  const sealed = decodeBase64Url(ciphertextB64);
  const opened = nacl.sealedbox.open(sealed, recipientSecretKey);
  if (!opened) {
    throw new Error('Failed to decrypt sealed box');
  }
  return opened;
}
