import { describe, expect, test } from 'bun:test';
import {
  buildBundlePayment,
  buildRelayPayment,
  encodePaymentPayload,
  parsePaymentRequired,
} from './index.js';

describe('payments', () => {
  test('encode and parse payment required', () => {
    const header = encodePaymentPayload({
      payment_id: 'pay_1',
      agent_did: 'did:web:a.local',
      purpose: 'bundle_purchase',
      bundle_id: 'starter',
      amount_cents: 100,
    });
    const parsed = parsePaymentRequired(
      Buffer.from(
        JSON.stringify({ accepts: [{ bundle_id: 'starter' }], scheme: 'x402-dev' }),
        'utf8',
      ).toString('base64url'),
    );
    expect(parsed.scheme).toBe('x402-dev');
    expect(header.length).toBeGreaterThan(10);
  });

  test('buildRelayPayment binds envelope', () => {
    const proof = buildRelayPayment('did:web:a.local', 2, '01JENV');
    const json = JSON.parse(Buffer.from(proof, 'base64url').toString('utf8')) as {
      purpose: string;
      envelope_id: string;
    };
    expect(json.purpose).toBe('relay');
    expect(json.envelope_id).toBe('01JENV');
  });

  test('buildBundlePayment includes bundle_id', () => {
    const proof = buildBundlePayment('did:web:a.local', 'starter', 100);
    const json = JSON.parse(Buffer.from(proof, 'base64url').toString('utf8')) as {
      bundle_id: string;
    };
    expect(json.bundle_id).toBe('starter');
  });
});
