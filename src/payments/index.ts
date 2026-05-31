const PAYMENT_REQUIRED = 'payment-required';
const PAYMENT_SIGNATURE = 'payment-signature';

export interface PaymentPayload {
  payment_id: string;
  agent_did: string;
  purpose: 'bundle_purchase' | 'relay';
  bundle_id?: string;
  amount_cents?: number;
  envelope_id?: string;
  cost_tokens?: number;
}

/**
 * Base64url-encodes a JSON payment payload for x402 dev stub.
 */
export function encodePaymentPayload(payload: PaymentPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Parses PAYMENT-REQUIRED header from a 402 response.
 */
export function parsePaymentRequired(headerValue: string): {
  accepts: Record<string, unknown>[];
  scheme: string;
} {
  const json = Buffer.from(headerValue, 'base64url').toString('utf8');
  return JSON.parse(json) as { accepts: Record<string, unknown>[]; scheme: string };
}

/**
 * Builds a dev relay payment proof for message.send.
 */
export function buildRelayPayment(
  agentDid: string,
  costTokens: number,
  envelopeId: string,
): string {
  return encodePaymentPayload({
    payment_id: `pay_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    agent_did: agentDid,
    purpose: 'relay',
    envelope_id: envelopeId,
    cost_tokens: costTokens,
  });
}

/**
 * Builds a dev bundle purchase payment proof.
 */
export function buildBundlePayment(
  agentDid: string,
  bundleId: string,
  amountCents: number,
): string {
  return encodePaymentPayload({
    payment_id: `pay_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    agent_did: agentDid,
    purpose: 'bundle_purchase',
    bundle_id: bundleId,
    amount_cents: amountCents,
  });
}

/**
 * Purchases a token bundle via HTTP 402 retry flow.
 */
export async function purchaseBundle(
  relayHttpUrl: string,
  agentDid: string,
  bundleId: string,
): Promise<{ tokens: number; balance: number }> {
  const url = `${relayHttpUrl}/v1/bundles/purchase`;
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_did: agentDid, bundle_id: bundleId }),
  });

  if (res.status === 402) {
    const required = res.headers.get(PAYMENT_REQUIRED);
    if (!required) {
      throw new Error('402 without payment-required header');
    }
    const parsed = parsePaymentRequired(required);
    const accept = parsed.accepts[0] as {
      amount_cents: number;
      bundle_id: string;
    };
    const sig = buildBundlePayment(agentDid, accept.bundle_id ?? bundleId, accept.amount_cents);
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [PAYMENT_SIGNATURE]: sig,
      },
      body: JSON.stringify({ agent_did: agentDid, bundle_id: bundleId }),
    });
  }

  if (!res.ok) {
    throw new Error(`purchase failed: ${res.status}`);
  }

  const receipt = (await res.json()) as { tokens: number; balance: number };
  return { tokens: receipt.tokens, balance: receipt.balance };
}

/**
 * Returns unsigned mandate JSON and base64 signing input for operator signing.
 */
export async function mandatePrepare(
  relayHttpUrl: string,
  fields: Record<string, string | number>,
): Promise<{ mandate: Record<string, unknown>; signing_input_base64: string }> {
  const res = await fetch(`${relayHttpUrl}/operator/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    throw new Error(`mandate prepare failed: ${res.status}`);
  }
  return (await res.json()) as {
    mandate: Record<string, unknown>;
    signing_input_base64: string;
  };
}

export { PAYMENT_REQUIRED, PAYMENT_SIGNATURE };
