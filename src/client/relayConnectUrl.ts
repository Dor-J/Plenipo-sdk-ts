/** Phoenix socket protocol version sent on relay WebSocket connect. */
export const PHOENIX_VSN = '2.0.0';

export interface RelayConnectParams {
  did: string;
  nonce: string;
  signature: string;
  didDocumentUrl: string;
}

/** Strips query params from a relay WebSocket base URL. */
export function relayWsBaseUrl(relayUrl: string): string {
  return relayUrl.split('?')[0] ?? relayUrl;
}

/**
 * Builds a relay WebSocket URL with auth query params.
 * Param order matches Python SDK and Core cluster tests (`vsn` last).
 */
export function buildRelayConnectUrl(
  relayUrl: string,
  params: RelayConnectParams,
): string {
  const base = relayWsBaseUrl(relayUrl);
  const query = [
    `did=${encodeURIComponent(params.did)}`,
    `nonce=${encodeURIComponent(params.nonce)}`,
    `signature=${encodeURIComponent(params.signature)}`,
    `did_document_url=${encodeURIComponent(params.didDocumentUrl)}`,
    `vsn=${PHOENIX_VSN}`,
  ].join('&');
  return `${base}?${query}`;
}

/** Sanitized debug metadata for relay WebSocket connects. */
export function relayConnectDebugMeta(
  relayUrl: string,
  params: RelayConnectParams,
): Record<string, unknown> {
  return {
    relay_url: relayWsBaseUrl(relayUrl),
    did: params.did,
    did_document_url: params.didDocumentUrl,
    encoded_query_keys: ['did', 'nonce', 'signature', 'did_document_url', 'vsn'],
    final_ws_url: redactSignature(buildRelayConnectUrl(relayUrl, params)),
  };
}

function redactSignature(url: string): string {
  const marker = 'signature=';
  const start = url.indexOf(marker);
  if (start < 0) {
    return url;
  }
  const end = url.indexOf('&', start);
  if (end < 0) {
    return `${url.slice(0, start + marker.length)}<redacted>`;
  }
  return `${url.slice(0, start + marker.length)}<redacted>${url.slice(end)}`;
}
