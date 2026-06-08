/** Returns the Core resolver URL for a Core-hosted DID document. */
export function coreHostedDocumentUrl(coreUrl: string, did: string): string {
  const encodedDid = encodeURIComponent(did);
  return `${coreUrl.replace(/\/$/, '')}/v1/dids/${encodedDid}`;
}
