/** Returns the Core resolver URL for a Core-hosted DID document. */
export function coreHostedDocumentUrl(coreUrl: string, did: string): string {
  const encodedDid = encodeURIComponent(did);
  return `${coreUrl.replace(/\/$/, '')}/v1/dids?did=${encodedDid}`;
}

/** Returns the required HTTPS document URL for an external did:web DID. */
export function externalDidWebDocumentUrl(did: string): string {
  const { host, pathSegments } = parseDidWeb(did);
  if (pathSegments.length === 0) {
    return `https://${host}/.well-known/did.json`;
  }
  const encoded = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
  return `https://${host}/${encoded}/did.json`;
}

/** Validates strict production did:web hosting rules. */
export function validateProductionDidWeb(did: string, documentUrl: string): void {
  const expected = externalDidWebDocumentUrl(did);
  const parsed = new URL(documentUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('production DID document URL must use https');
  }
  if (documentUrl !== expected) {
    throw new Error(`DID document URL must be ${expected}`);
  }
}

/** Returns true for dev-only Core-hosted local DIDs. */
export function isCoreHostedLocalDid(did: string): boolean {
  return did.startsWith('did:web:localhost:agents:');
}

function parseDidWeb(did: string): { host: string; pathSegments: string[] } {
  const prefix = 'did:web:';
  if (!did.startsWith(prefix) || did === prefix) {
    throw new Error('DID must use did:web');
  }
  const parts = did.slice(prefix.length).split(':');
  if (parts.some((part) => part === '')) {
    throw new Error('did:web contains an empty segment');
  }
  return {
    host: decodeURIComponent(parts[0] ?? ''),
    pathSegments: parts.slice(1).map((part) => decodeURIComponent(part)),
  };
}
