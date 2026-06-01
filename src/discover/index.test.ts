import { afterEach, describe, expect, it } from 'bun:test';
import { discoverAgents } from './index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('discoverAgents', () => {
  it('sends query, capability, and limit params', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          results: [{ did: 'did:web:agent.local', document_url: 'https://agent.local/did.json' }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const results = await discoverAgents({
      query: 'agent',
      capability: 'messaging',
      limit: 5,
      registryUrl: 'https://registry.example',
    });

    expect(results[0]?.did).toBe('did:web:agent.local');
    expect(calls[0]).toBe(
      'https://registry.example/api/v1/search?query=agent&capability=messaging&limit=5',
    );
  });

  it('raises on registry errors', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'down' }), { status: 503 })) as unknown as typeof fetch;

    await expect(discoverAgents({ registryUrl: 'https://registry.example' })).rejects.toThrow(
      'Registry search failed: 503',
    );
  });
});
