import * as ed from '@noble/ed25519';
import { encodeBase64Url } from './base64url.js';

/** Signs a message with an Ed25519 secret key (32 bytes). */
export async function sign(message: Uint8Array, secretKey: Uint8Array): Promise<string> {
  const signature = await ed.signAsync(message, secretKey);
  return encodeBase64Url(signature);
}

/** Verifies an Ed25519 detached signature. */
export async function verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  return ed.verifyAsync(signature, message, publicKey);
}
