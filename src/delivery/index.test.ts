import { afterEach, describe, expect, it } from 'bun:test';
import { buildReceipt, getDeliveryStatus } from './index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('delivery', () => {
  it('buildReceipt returns envelope_id payload', () => {
    expect(buildReceipt('01HX')).toEqual({ envelope_id: '01HX' });
  });

  it('getDeliveryStatus returns REST response body', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          type: 'delivery_status',
          v: '1.0',
          envelope_id: '01J ENV',
          status: 'delivered',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    await expect(getDeliveryStatus('https://relay.example', '01J ENV')).resolves.toMatchObject({
      status: 'delivered',
    });
    expect(calls[0]).toBe('https://relay.example/v1/delivery/01J%20ENV');
  });

  it('getDeliveryStatus raises on non-2xx', async () => {
    globalThis.fetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;

    await expect(getDeliveryStatus('https://relay.example', '01J')).rejects.toThrow(
      /delivery status failed: 404/,
    );
  });
});
