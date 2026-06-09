import { encodeBase64Url } from '../crypto/base64url.js';

/** Encodes an opaque receipt list cursor. */
export function encodeReceiptCursor(deliveredAt: string, envelopeId: string): string {
  const payload = JSON.stringify({ delivered_at: deliveredAt, envelope_id: envelopeId });
  return encodeBase64Url(new TextEncoder().encode(payload));
}

/** Builds a cursor from a receipt payload when timestamps are present. */
export function cursorFromReceiptPayload(payload: Record<string, unknown>): string | null {
  const deliveredAt = payload.delivered_at ?? payload.received_at;
  const envelopeId = payload.envelope_id;
  if (!deliveredAt || !envelopeId) {
    return null;
  }
  return encodeReceiptCursor(String(deliveredAt), String(envelopeId));
}
