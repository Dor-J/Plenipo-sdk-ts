import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sodium from 'libsodium-wrappers-sumo';
import { plenipoHome } from '../identity/store.js';

export const PLAINTEXT_ALG = 'nacl-secretbox-v1';
const STORE_KEY_BYTES = 32;

await sodium.ready;

/** Raised when the local sidecar store key is missing or invalid. */
export class SidecarStoreKeyError extends Error {}

/** Returns the path to the local sidecar store encryption key. */
export function sidecarStoreKeyPath(): string {
  return join(plenipoHome(), 'sidecar-store.key');
}

/** Generates a 32-byte random store key. */
export function generateSidecarStoreKey(): Uint8Array {
  return sodium.randombytes_buf(STORE_KEY_BYTES);
}

/** Persists the store key with restrictive permissions where supported. */
export function writeSidecarStoreKey(key: Uint8Array, path = sidecarStoreKeyPath()): string {
  if (key.length !== STORE_KEY_BYTES) {
    throw new Error('sidecar store key must be 32 bytes');
  }
  mkdirSync(plenipoHome(), { recursive: true });
  writeFileSync(path, Buffer.from(key));
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on Windows.
  }
  return path;
}

/** Reads the store key from disk when present. */
export function readSidecarStoreKey(path = sidecarStoreKeyPath()): Uint8Array | null {
  if (!existsSync(path)) {
    return null;
  }
  const key = readFileSync(path);
  if (key.length !== STORE_KEY_BYTES) {
    throw new SidecarStoreKeyError(`invalid sidecar store key at ${path}`);
  }
  return new Uint8Array(key);
}

/** Resolves the local sidecar store key, generating it on first use when allowed. */
export function resolveSidecarStoreKey(options?: {
  generateIfMissing?: boolean;
  path?: string;
}): Uint8Array {
  const path = options?.path ?? sidecarStoreKeyPath();
  const existing = readSidecarStoreKey(path);
  if (existing) {
    return existing;
  }
  if (options?.generateIfMissing === false) {
    throw new SidecarStoreKeyError(
      'sidecar store key missing; cannot decrypt encrypted local inbox',
    );
  }
  const key = generateSidecarStoreKey();
  writeSidecarStoreKey(key, path);
  return key;
}

/** Encrypts plaintext for inbox storage. */
export function encryptPlaintext(
  plaintext: string,
  key: Uint8Array,
): { ciphertextB64: string; nonceB64: string } {
  if (key.length !== STORE_KEY_BYTES) {
    throw new Error('sidecar store key must be 32 bytes');
  }
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  return {
    ciphertextB64: Buffer.from(ciphertext).toString('base64url'),
    nonceB64: Buffer.from(nonce).toString('base64url'),
  };
}

/** Decrypts inbox plaintext ciphertext. */
export function decryptPlaintext(
  ciphertextB64: string,
  nonceB64: string,
  key: Uint8Array,
): string {
  if (key.length !== STORE_KEY_BYTES) {
    throw new Error('sidecar store key must be 32 bytes');
  }
  try {
    const plain = sodium.crypto_secretbox_open_easy(
      Buffer.from(ciphertextB64, 'base64url'),
      Buffer.from(nonceB64, 'base64url'),
      key,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new SidecarStoreKeyError('failed to decrypt local inbox plaintext');
  }
}
