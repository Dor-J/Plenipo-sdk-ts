import { base58btc } from 'multiformats/bases/base58';
import { discoverAgents } from '../discover/index.js';

export interface ResolveEncKeyOptions {
  recipientDid: string;
  recipientDocumentUrl?: string;
  registryUrl?: string;
  relayHttpUrl?: string;
}

/**
 * Resolves recipient X25519 encryption public key from a DID document.
 */
export async function resolveEncPublicKey(options: ResolveEncKeyOptions): Promise<Uint8Array> {
  const document = await fetchDidDocument(options);
  return encPublicKeyFromDocument(document, options.recipientDid);
}

/**
 * Fetches a DID document using registry, did:web, or relay resolver.
 */
export async function fetchDidDocument(options: ResolveEncKeyOptions): Promise<Record<string, unknown>> {
  if (options.recipientDocumentUrl) {
    return fetchJson(options.recipientDocumentUrl);
  }

  try {
    const results = await discoverAgents({
      query: options.recipientDid,
      limit: 5,
      registryUrl: options.registryUrl,
    });
    const match = results.find((r) => r.did === options.recipientDid);
    if (match?.document_url) {
      return fetchJson(match.document_url);
    }
  } catch {
    // Registry optional
  }

  const webUrl = didWebDocumentUrl(options.recipientDid);
  if (webUrl) {
    try {
      return fetchJson(webUrl);
    } catch {
      // Fall through to relay
    }
  }

  const relayBase = options.relayHttpUrl ?? process.env.PLENIPO_RELAY_HTTP_URL ?? 'http://localhost:4000';
  const encodedDid = encodeURIComponent(options.recipientDid);
  return fetchJson(`${relayBase}/v1/dids/${encodedDid}`);
}

/**
 * Extracts X25519 public key bytes from a DID document.
 */
export function encPublicKeyFromDocument(
  document: Record<string, unknown>,
  did: string,
): Uint8Array {
  const methods = document.verificationMethod;
  if (!Array.isArray(methods)) {
    throw new Error('DID document missing verificationMethod');
  }

  const encMethod =
    methods.find((m) => {
      if (!m || typeof m !== 'object') return false;
      const vm = m as Record<string, unknown>;
      const id = String(vm.id ?? '');
      const type = String(vm.type ?? '');
      return (
        type === 'X25519KeyAgreementKey2020' ||
        id.endsWith('#enc-key') ||
        (Array.isArray(document.keyAgreement) &&
          (document.keyAgreement as string[]).includes(id))
      );
    }) ?? methods.find((m) => {
      if (!m || typeof m !== 'object') return false;
      return String((m as Record<string, unknown>).type ?? '').includes('X25519');
    });

  if (!encMethod || typeof encMethod !== 'object') {
    throw new Error(`No encryption key in DID document for ${did}`);
  }

  const multibase = String((encMethod as Record<string, unknown>).publicKeyMultibase ?? '');
  if (!multibase) {
    throw new Error('Encryption verification method missing publicKeyMultibase');
  }

  return decodeMultibaseX25519(multibase);
}

function decodeMultibaseX25519(multibase: string): Uint8Array {
  if (!multibase.startsWith('z')) {
    throw new Error('Unsupported publicKeyMultibase encoding');
  }
  const raw = base58btc.decode(multibase.slice(1));
  if (raw.length !== 34 || raw[0] !== 0xec || raw[1] !== 0x01) {
    throw new Error('Invalid X25519 multibase key');
  }
  return raw.slice(2);
}

function didWebDocumentUrl(did: string): string | null {
  if (!did.startsWith('did:web:')) return null;
  const path = did.slice('did:web:'.length).split(':').join('/');
  const host = path.split('/')[0];
  const rest = path.includes('/') ? `/${path.split('/').slice(1).join('/')}` : '';
  return `https://${host}${rest}/.well-known/did.json`;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch DID document (${res.status}): ${url}`);
  }
  return (await res.json()) as Record<string, unknown>;
}
