import sodium from 'libsodium-wrappers-sumo';
import { decodeBase64Url, encodeBase64Url } from './base64url.js';

await sodium.ready;

/** Seals plaintext to recipient X25519 public key (libsodium crypto_box_seal). */
export function seal(plaintext: Uint8Array, recipientPublicKey: Uint8Array): string {
  const sealed = sodium.crypto_box_seal(plaintext, recipientPublicKey);
  return encodeBase64Url(sealed);
}

/** Opens sealed ciphertext with recipient X25519 secret key. */
export function openSealed(ciphertextB64: string, recipientSecretKey: Uint8Array): Uint8Array {
  const sealed = decodeBase64Url(ciphertextB64);
  const recipientPublicKey = sodium.crypto_scalarmult_base(recipientSecretKey);

  try {
    return sodium.crypto_box_seal_open(sealed, recipientPublicKey, recipientSecretKey);
  } catch {
    throw new Error('Failed to decrypt sealed box');
  }
}
