import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildBundlePayment,
  buildRelayPayment,
  encodePaymentPayload,
  mandatePrepare,
  parsePaymentRequired,
  purchaseBundle,
} from './index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

  test('purchaseBundle handles 402 retry flow', async () => {
    const required = encodePaymentPayload({
      payment_id: 'not-used',
      agent_did: 'did:web:a.local',
      purpose: 'bundle_purchase',
      bundle_id: 'starter',
      amount_cents: 100,
    });
    const paymentRequired = Buffer.from(
      JSON.stringify({ accepts: [{ bundle_id: 'starter', amount_cents: 100 }], scheme: 'x402-dev' }),
      'utf8',
    ).toString('base64url');
    expect(required.length).toBeGreaterThan(10);

    const calls: RequestInit[] = [];
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push(init ?? {});
      if (calls.length === 1) {
        return new Response('', {
          status: 402,
          headers: { 'payment-required': paymentRequired },
        });
      }
      return new Response(JSON.stringify({ tokens: 1000, balance: 1000 }), { status: 200 });
    }) as typeof fetch;

    await expect(purchaseBundle('https://relay.example', 'did:web:a.local', 'starter')).resolves.toEqual({
      tokens: 1000,
      balance: 1000,
    });
    expect(calls).toHaveLength(2);
    expect((calls[1]?.headers as Record<string, string>)['payment-signature']).toBeDefined();
  });

  test('purchaseBundle rejects missing payment-required header and final HTTP errors', async () => {
    globalThis.fetch = (async () => new Response('', { status: 402 })) as unknown as typeof fetch;
    await expect(purchaseBundle('https://relay.example', 'did:web:a.local', 'starter')).rejects.toThrow(
      /payment-required/,
    );

    globalThis.fetch = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(purchaseBundle('https://relay.example', 'did:web:a.local', 'starter')).rejects.toThrow(
      /purchase failed: 500/,
    );
  });

  test('mandatePrepare posts fields and returns response body', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return new Response(
        JSON.stringify({
          mandate: { agent_did: 'did:web:a.local' },
          signing_input_base64: 'SIG',
        }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;

    await expect(
      mandatePrepare('https://relay.example', { agent_did: 'did:web:a.local' }),
    ).resolves.toEqual({ mandate: { agent_did: 'did:web:a.local' }, signing_input_base64: 'SIG' });
    expect(calls[0]?.input).toBe('https://relay.example/operator/prepare');
    expect(calls[0]?.init?.method).toBe('POST');
  });
});
