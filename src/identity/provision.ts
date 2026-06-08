import { randomBytes } from 'node:crypto';
import { createDidDocument } from '../did/create.js';
import type { McpRuntimeConfig } from '../mcp/runtime.js';
import { syncIdentityWithCore } from './sync.js';
import { coreHostedDocumentUrl } from './urls.js';
import {
  identityFromCreateResult,
  loadIdentity,
  saveIdentity,
  type AgentIdentity,
} from './store.js';

function defaultCoreUrl(): string {
  return process.env.PLENIPO_CORE_URL ?? 'http://localhost:4000';
}

function defaultRelayUrl(): string {
  return process.env.PLENIPO_RELAY_URL ?? 'ws://localhost:4000/agent/websocket';
}

function defaultRegistryUrl(): string {
  return process.env.PLENIPO_REGISTRY_URL ?? 'http://localhost:4001';
}

function envIdentityComplete(): AgentIdentity | null {
  const did = process.env.PLENIPO_DID;
  const auth =
    process.env.PLENIPO_AUTH_SECRET_B64 ?? process.env.PLENIPO_DID_PRIVATE_KEY;
  const docUrl = process.env.PLENIPO_DID_DOCUMENT_URL;
  if (!did || !auth || !docUrl) {
    return null;
  }

  const relay = defaultRelayUrl();
  const registry = defaultRegistryUrl();
  const core = defaultCoreUrl();
  const enc = process.env.PLENIPO_ENC_SECRET_B64 ?? '';

  return identityFromCreateResult({
    did,
    authSecretB64: auth,
    encSecretB64: enc,
    didDocumentUrl: docUrl,
    document: {
      id: did,
      service: [
        {
          type: 'PlenipoAgent',
          serviceEndpoint: relay,
          capabilities: ['general'],
        },
      ],
    },
    relayUrl: relay,
    registryUrl: registry,
    coreUrl: core,
    didDocumentMode: 'external',
    coreRegistered: true,
    registrationPending: false,
  });
}

/** Generates keys and persists identity locally without contacting Core. */
export async function createLocalIdentity(options?: {
  coreUrl?: string;
  relayUrl?: string;
  registryUrl?: string;
}): Promise<AgentIdentity> {
  const core = options?.coreUrl ?? defaultCoreUrl();
  const relay = options?.relayUrl ?? defaultRelayUrl();
  const registry = options?.registryUrl ?? defaultRegistryUrl();
  const agentId = randomBytes(8).toString('hex');

  const created = await createDidDocument('localhost', {
    relayUrl: relay,
    pathSegments: ['agents', agentId],
  });

  const identity = identityFromCreateResult({
    did: created.did,
    authSecretB64: created.privateKeys.authSecretKey,
    encSecretB64: created.privateKeys.encSecretKey,
    didDocumentUrl: coreHostedDocumentUrl(core, created.did),
    document: created.document,
    relayUrl: relay,
    registryUrl: registry,
    coreUrl: core,
    didDocumentMode: 'core_hosted',
    coreRegistered: false,
    registrationPending: true,
  });
  saveIdentity(identity);
  return identity;
}

/** Creates a local identity and attempts immediate Core registration. */
export async function provisionIdentity(options?: {
  coreUrl?: string;
  relayUrl?: string;
  registryUrl?: string;
}): Promise<AgentIdentity> {
  const identity = await createLocalIdentity(options);
  const [synced] = await syncIdentityWithCore(identity);
  return synced;
}

/** Loads env, file, or creates local identity; best-effort Core sync. */
export async function ensureIdentity(): Promise<AgentIdentity> {
  const envIdentity = envIdentityComplete();
  if (envIdentity) {
    return envIdentity;
  }

  let stored = loadIdentity();
  if (!stored) {
    stored = await createLocalIdentity();
  }

  if (
    stored.didDocumentMode === 'core_hosted' &&
    (stored.registrationPending || !stored.coreRegistered)
  ) {
    const [synced] = await syncIdentityWithCore(stored);
    return synced;
  }

  return stored;
}

/** Maps a persisted identity to MCP runtime configuration. */
export function identityToMcpConfig(identity: AgentIdentity): McpRuntimeConfig {
  return {
    did: identity.did,
    authSecretB64: identity.authSecretB64,
    didDocumentUrl: identity.didDocumentUrl,
    relayUrl: identity.relayUrl,
    encSecretB64: identity.encSecretB64 || undefined,
    registryUrl: identity.registryUrl,
  };
}
