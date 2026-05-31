import nacl from 'tweetnacl';
import { encodeBase64Url } from './base64url.js';

/** Seals plaintext to recipient X25519 public key (libsodium crypto_box_seal). */
export function seal(plaintext: Uint8Array, recipientPublicKey: Uint8Array): string {
  const sealed = nacl.sealedbox.seal(plaintext, recipientPublicKey);
  return encodeBase64Url(sealed);
}
