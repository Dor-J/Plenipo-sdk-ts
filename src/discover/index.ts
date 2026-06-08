import { normalizeRouteRecord, type RouteRecord } from '../identity/route.js';

export interface DiscoverOptions {
  query?: string;
  capability?: string;
  protocol?: string;
  paymentScheme?: string;
  maxPricePerKbTokens?: number;
  online?: boolean;
  limit?: number;
  registryUrl?: string;
}

export type AgentSearchResult = RouteRecord;

/**
 * Searches the Plenipo DID registry and returns Route Records.
 */
export async function discoverAgents(
  options: DiscoverOptions = {},
): Promise<RouteRecord[]> {
  const base = options.registryUrl ?? process.env.PLENIPO_REGISTRY_URL ?? 'http://localhost:4001';
  const params = new URLSearchParams();
  if (options.query) params.set('query', options.query);
  if (options.capability) params.set('capability', options.capability);
  if (options.protocol) params.set('protocol', options.protocol);
  if (options.paymentScheme) params.set('payment_scheme', options.paymentScheme);
  if (options.maxPricePerKbTokens !== undefined) {
    params.set('max_price_per_kb_tokens', String(options.maxPricePerKbTokens));
  }
  if (options.online) params.set('online', 'true');
  if (options.limit) params.set('limit', String(options.limit));

  const res = await fetch(`${base}/api/v1/search?${params}`);
  if (!res.ok) throw new Error(`Registry search failed: ${res.status}`);
  const body = (await res.json()) as { results: Record<string, unknown>[] };
  return body.results.map((item) => normalizeRouteRecord(item));
}

export { normalizeRouteRecord, type RouteRecord };
