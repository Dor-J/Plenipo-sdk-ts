import { createHash } from 'node:crypto';
import { encodeBase64Url, decodeBase64Url } from './base64url.js';

export interface EnvelopeFields {
  v: string;
  envelope_id: string;
  sender_did: string;
  recipient_did: string;
  created_at: string;
  ciphertext: string;
}

/** Builds canonical signing input per PROTOCOL §7.2. */
export function buildSigningInput(envelope: EnvelopeFields): Uint8Array {
  const hash = createHash('sha256')
    .update(decodeBase64Url(envelope.ciphertext))
    .digest();
  const hashLine = encodeBase64Url(hash);
  const canonical = [
    envelope.v,
    envelope.envelope_id,
    envelope.sender_did,
    envelope.recipient_did,
    envelope.created_at,
    hashLine,
  ].join('\n');
  return new TextEncoder().encode(canonical);
}
