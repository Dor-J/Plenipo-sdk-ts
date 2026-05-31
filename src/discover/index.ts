export interface DiscoverOptions {
  query?: string;
  capability?: string;
  limit?: number;
  registryUrl?: string;
}

export interface AgentSearchResult {
  did: string;
  document_url: string;
  capabilities: string[];
  service_endpoint?: string;
  last_indexed_at?: string;
}

/**
 * Searches the Plenipo DID registry.
 */
export async function discoverAgents(
  options: DiscoverOptions = {},
): Promise<AgentSearchResult[]> {
  const base = options.registryUrl ?? process.env.PLENIPO_REGISTRY_URL ?? 'http://localhost:4001';
  const params = new URLSearchParams();
  if (options.query) params.set('query', options.query);
  if (options.capability) params.set('capability', options.capability);
  if (options.limit) params.set('limit', String(options.limit));

  const res = await fetch(`${base}/api/v1/search?${params}`);
  if (!res.ok) throw new Error(`Registry search failed: ${res.status}`);
  const body = (await res.json()) as { results: AgentSearchResult[] };
  return body.results;
}
