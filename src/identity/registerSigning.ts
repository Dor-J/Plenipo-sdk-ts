import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import { decodeBase64Url, encodeBase64Url } from '../crypto/base64url.js';

export const REGISTER_TYPE = 'plenipo.did.register';
export const REGISTER_VERSION = '1.0';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(record[key]);
        return acc;
      }, {});
  }
  return value;
}

/** Computes a SHA-256 fingerprint for a DID document. */
export function documentFingerprint(document: Record<string, unknown>): string {
  const encoded = JSON.stringify(canonicalize(document));
  return createHash('sha256').update(encoded).digest('hex');
}

/** Builds the canonical registration signing payload. */
export function buildRegisterPayload(input: {
  nonce: string;
  did: string;
  document: Record<string, unknown>;
  timestamp?: string;
}): Record<string, string> {
  return {
    type: REGISTER_TYPE,
    v: REGISTER_VERSION,
    nonce: input.nonce,
    did: input.did,
    document_fingerprint: documentFingerprint(input.document),
    timestamp: input.timestamp ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

/** Returns UTF-8 bytes for the canonical registration payload. */
export function signingBytes(payload: Record<string, string>): Uint8Array {
  const sorted = Object.keys(payload)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = payload[key] ?? '';
      return acc;
    }, {});
  return new TextEncoder().encode(JSON.stringify(sorted));
}

/** Signs a registration payload with the agent auth key. */
export function signRegisterPayload(payload: Record<string, string>, authSecretB64: string): string {
  const signing = nacl.sign.keyPair.fromSeed(decodeBase64Url(authSecretB64));
  const signature = nacl.sign.detached(signingBytes(payload), signing.secretKey);
  return encodeBase64Url(signature);
}

/** Signs a rotation payload with both previous and new auth keys. */
export function signRotationPayload(
  payload: Record<string, string>,
  keys: { previousAuthSecretB64: string; newAuthSecretB64: string },
): { previous_signature: string; signature: string } {
  return {
    previous_signature: signRegisterPayload(payload, keys.previousAuthSecretB64),
    signature: signRegisterPayload(payload, keys.newAuthSecretB64),
  };
}
