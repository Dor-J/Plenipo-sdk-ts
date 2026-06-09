import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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
    return fetchDidJson(options.recipientDocumentUrl, options.recipientDid, options.relayHttpUrl);
  }

  try {
    const results = await discoverAgents({
      query: options.recipientDid,
      limit: 5,
      registryUrl: options.registryUrl,
    });
    const match = results.find((r) => r.did === options.recipientDid);
    if (match?.document_url) {
      return await fetchDidJson(match.document_url, options.recipientDid, options.relayHttpUrl);
    }
  } catch {
    // Registry optional
  }

  const webUrl = didWebDocumentUrl(options.recipientDid);
  if (webUrl) {
    try {
      return await fetchDidJson(webUrl, options.recipientDid, options.relayHttpUrl);
    } catch {
      // Fall through to relay
    }
  }

  const relayBase = options.relayHttpUrl ?? process.env.PLENIPO_RELAY_HTTP_URL ?? 'http://localhost:4000';
  const encodedDid = encodeURIComponent(options.recipientDid);
  return fetchJson(`${relayBase.replace(/\/$/, '')}/v1/dids?did=${encodedDid}`);
}

/**
 * Extracts X25519 public key bytes from a DID document.
 */
export function encPublicKeyFromDocument(
  document: Record<string, unknown>,
  did: string,
): Uint8Array {
  if (document.id !== did) {
    throw new Error(`DID document id mismatch for ${did}`);
  }

  const methods = document.verificationMethod;
  if (!Array.isArray(methods)) {
    throw new Error('DID document missing verificationMethod');
  }

  const keyAgreement = document.keyAgreement;
  if (!Array.isArray(keyAgreement) || !keyAgreement.every((ref) => typeof ref === 'string')) {
    throw new Error('DID document missing keyAgreement');
  }
  const keyAgreementRefs = keyAgreement as string[];

  const encMethod =
    methods.find((m) => {
      if (!m || typeof m !== 'object') return false;
      const vm = m as Record<string, unknown>;
      const id = String(vm.id ?? '');
      const type = String(vm.type ?? '');
      const controller = vm.controller;
      return (
        keyAgreementRefs.includes(id) &&
        type === 'X25519KeyAgreementKey2020' &&
        (controller === undefined || controller === did)
      );
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

async function fetchDidJson(url: string, did: string, relayHttpUrl?: string): Promise<Record<string, unknown>> {
  await validateDocumentUrlForDid(url, did, relayHttpUrl);
  return fetchJson(url);
}

async function validateDocumentUrlForDid(
  url: string,
  did: string,
  relayHttpUrl = 'http://localhost:4000',
): Promise<void> {
  const allowUnsafe = process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH === 'true';
  const coreHosted = isCoreHostedDocumentUrl(url, did, relayHttpUrl);
  const expected = didWebDocumentUrl(did);
  if (!expected && !coreHosted) {
    throw new Error(`Unsupported DID method for direct document fetch: ${did}`);
  }

  const parsed = new URL(url);
  if (!allowUnsafe && parsed.protocol !== 'https:' && !coreHosted) {
    throw new Error('DID document URL must use https');
  }

  if (!allowUnsafe && !coreHosted && parsed.toString() !== expected) {
    throw new Error('DID document URL does not match did:web document URL');
  }

  if (!allowUnsafe && !coreHosted) {
    await assertPublicHost(parsed.hostname);
  }
}

function isCoreHostedDocumentUrl(url: string, did: string, relayHttpUrl: string): boolean {
  if (!did.startsWith('did:web:localhost:agents:')) return false;
  const base = relayHttpUrl.replace(/\/$/, '');
  const expected = `${base}/v1/dids?did=${encodeURIComponent(did)}`;
  return url === expected || url.startsWith(`${base}/v1/dids/`);
}

async function assertPublicHost(hostname: string): Promise<void> {
  const literalKind = isIP(hostname);
  const addresses =
    literalKind === 0
      ? await lookup(hostname, { all: true, verbatim: true })
      : [{ address: hostname }];

  if (addresses.some(({ address }) => blockedAddress(address))) {
    throw new Error('DID document URL host resolves to a blocked address');
  }
}

function blockedAddress(address: string): boolean {
  if (address.includes(':')) {
    return blockedIpv6(address);
  }

  const parts = address.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }

  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function blockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('ff') ||
    normalized.includes('::ffff:')
  );
}

function decodeMultibaseX25519(multibase: string): Uint8Array {
  if (!multibase.startsWith('z')) {
    throw new Error('Unsupported publicKeyMultibase encoding');
  }
  const raw = base58btc.decode(multibase);
  if (raw.length !== 34 || raw[0] !== 0xec || raw[1] !== 0x01) {
    throw new Error('Invalid X25519 multibase key');
  }
  return raw.slice(2);
}

function didWebDocumentUrl(did: string): string | null {
  if (!did.startsWith('did:web:')) return null;
  const [host, ...pathSegments] = did.slice('did:web:'.length).split(':');
  if (!host || pathSegments.some((segment) => !segment)) return null;

  if (pathSegments.length === 0) {
    return `https://${decodeURIComponent(host)}/.well-known/did.json`;
  }

  const path = pathSegments.map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/');
  return `https://${decodeURIComponent(host)}/${path}/did.json`;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { redirect: 'error' });
  if (!res.ok) {
    throw new Error(`Failed to fetch DID document (${res.status}): ${url}`);
  }
  return (await res.json()) as Record<string, unknown>;
}
