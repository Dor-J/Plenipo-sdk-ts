/**
 * Delivery status and receipt helpers for v0.4.
 */

export type DeliveryStatus =
  | 'queued'
  | 'delivered'
  | 'receipt_confirmed'
  | 'expired'
  | 'not_found';

export interface DeliveryStatusResponse {
  type: 'delivery_status';
  v: string;
  envelope_id: string;
  status: DeliveryStatus;
  queued_until?: string;
  received_at?: string;
}

/** Persisted delivery receipt with billing metadata. */
export interface DeliveryReceiptRecord {
  type?: 'delivery_receipt';
  v?: string;
  envelope_id: string;
  message_id?: string;
  sender_did?: string;
  recipient_did?: string;
  ciphertext_bytes?: number;
  billable_kb?: number;
  charged_tokens?: number;
  balance_after?: number;
  received_at?: string;
  delivered_at?: string;
}

export interface ReceiptListResponse {
  type: 'receipt.list.result';
  v: string;
  receipts: DeliveryReceiptRecord[];
  next_cursor?: string | null;
}

/**
 * Fetches delivery status via REST.
 */
export async function getDeliveryStatus(
  relayHttpUrl: string,
  envelopeId: string,
): Promise<DeliveryStatusResponse> {
  const res = await fetch(`${relayHttpUrl}/v1/delivery/${encodeURIComponent(envelopeId)}`);
  if (!res.ok) {
    throw new Error(`delivery status failed: ${res.status}`);
  }
  return (await res.json()) as DeliveryStatusResponse;
}

/**
 * Builds a message.receipt payload for the relay channel.
 */
export function buildReceipt(envelopeId: string): { envelope_id: string } {
  return { envelope_id: envelopeId };
}
