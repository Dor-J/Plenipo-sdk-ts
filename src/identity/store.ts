import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type DidDocumentMode = 'core_hosted' | 'external';

export interface AgentIdentity {
  did: string;
  authSecretB64: string;
  encSecretB64: string;
  didDocumentUrl: string;
  relayUrl: string;
  registryUrl: string;
  coreUrl: string;
  capabilities: string[];
  createdAt: string;
  document: Record<string, unknown>;
  didDocumentMode: DidDocumentMode;
  coreRegistered: boolean;
  registrationPending: boolean;
  lastRegistrationError: string | null;
  documentFingerprint: string | null;
}

/** Returns the Plenipo home directory. */
export function plenipoHome(): string {
  return process.env.PLENIPO_HOME ?? join(homedir(), '.plenipo');
}

/** Returns the default identity file path. */
export function identityPath(): string {
  return join(plenipoHome(), 'identity.json');
}

/** Loads identity from disk when present. */
export function loadIdentity(path = identityPath()): AgentIdentity | null {
  if (!existsSync(path)) {
    return null;
  }

  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const rawMode = String(raw.did_document_mode ?? 'core_hosted');
  const didDocumentMode: DidDocumentMode =
    rawMode === 'core_hosted' || rawMode === 'external' ? rawMode : 'core_hosted';

  return {
    did: String(raw.did),
    authSecretB64: String(raw.auth_secret_b64),
    encSecretB64: String(raw.enc_secret_b64),
    didDocumentUrl: String(raw.did_document_url),
    relayUrl: String(raw.relay_url),
    registryUrl: String(raw.registry_url),
    coreUrl: String(raw.core_url),
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [],
    createdAt: String(raw.created_at ?? ''),
    document: (raw.document as Record<string, unknown>) ?? {},
    didDocumentMode,
    coreRegistered: raw.core_registered !== undefined ? Boolean(raw.core_registered) : true,
    registrationPending: Boolean(raw.registration_pending ?? false),
    lastRegistrationError:
      raw.last_registration_error === null || raw.last_registration_error === undefined
        ? null
        : String(raw.last_registration_error),
    documentFingerprint:
      raw.document_fingerprint === null || raw.document_fingerprint === undefined
        ? null
        : String(raw.document_fingerprint),
  };
}

/** Persists identity to disk with restrictive permissions. */
export function saveIdentity(identity: AgentIdentity, path = identityPath()): string {
  mkdirSync(plenipoHome(), { recursive: true });
  const payload = {
    did: identity.did,
    auth_secret_b64: identity.authSecretB64,
    enc_secret_b64: identity.encSecretB64,
    did_document_url: identity.didDocumentUrl,
    relay_url: identity.relayUrl,
    registry_url: identity.registryUrl,
    core_url: identity.coreUrl,
    capabilities: identity.capabilities,
    created_at: identity.createdAt,
    document: identity.document,
    did_document_mode: identity.didDocumentMode,
    core_registered: identity.coreRegistered,
    registration_pending: identity.registrationPending,
    last_registration_error: identity.lastRegistrationError,
    document_fingerprint: identity.documentFingerprint,
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on platforms that do not support chmod.
  }
  return path;
}

/** Builds an AgentIdentity from DID creation output. */
export function identityFromCreateResult(input: {
  did: string;
  authSecretB64: string;
  encSecretB64: string;
  didDocumentUrl: string;
  document: Record<string, unknown>;
  relayUrl: string;
  registryUrl: string;
  coreUrl: string;
  capabilities?: string[];
  didDocumentMode?: DidDocumentMode;
  coreRegistered?: boolean;
  registrationPending?: boolean;
  lastRegistrationError?: string | null;
  documentFingerprint?: string | null;
}): AgentIdentity {
  return {
    did: input.did,
    authSecretB64: input.authSecretB64,
    encSecretB64: input.encSecretB64,
    didDocumentUrl: input.didDocumentUrl,
    relayUrl: input.relayUrl,
    registryUrl: input.registryUrl,
    coreUrl: input.coreUrl,
    capabilities: input.capabilities ?? capabilitiesFromDocument(input.document),
    createdAt: new Date().toISOString(),
    document: input.document,
    didDocumentMode: input.didDocumentMode ?? 'core_hosted',
    coreRegistered: input.coreRegistered ?? false,
    registrationPending: input.registrationPending ?? true,
    lastRegistrationError: input.lastRegistrationError ?? null,
    documentFingerprint: input.documentFingerprint ?? null,
  };
}

function capabilitiesFromDocument(document: Record<string, unknown>): string[] {
  const services = Array.isArray(document.service) ? document.service : [];
  for (const service of services) {
    if (
      typeof service === 'object' &&
      service !== null &&
      (service as Record<string, unknown>).type === 'PlenipoAgent'
    ) {
      const caps = (service as Record<string, unknown>).capabilities;
      if (Array.isArray(caps)) {
        return caps.map(String);
      }
    }
  }
  return [];
}
