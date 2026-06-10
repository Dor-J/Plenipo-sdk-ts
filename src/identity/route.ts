import { ensureIdentity } from './provision.js';
import { documentFingerprint } from './registerSigning.js';
import { syncIdentityWithCore } from './sync.js';
import { saveIdentity, type AgentIdentity } from './store.js';

export const ENCRYPTION_ALG = 'x25519-xsalsa20poly1305';
const SUPPORTED_PROTOCOLS = new Set(['plenipo.message.v1']);
const SUPPORTED_PAYMENT_MODELS = new Set(['per_kb']);
const SUPPORTED_SCHEMES = new Set(['plenipo-prepaid-token']);
const MAX_PROTOCOLS = 16;
const MAX_SCHEMES = 8;
const MAX_PRICE_PER_KB = 1000;

export interface RouteRecord {
  did: string;
  document_url: string;
  service_endpoint?: string;
  protocols: string[];
  capabilities: string[];
  encryption: { alg: string; public_key_ref: string };
  payment: {
    model: 'per_kb';
    price_per_kb_tokens: number;
    accepted_schemes: string[];
  };
  limits: { max_message_kb: number; offline_queue_ttl_seconds: number };
  status?: { last_seen_at: string | null; delivery_success_rate: number | null };
  document_fingerprint?: string | null;
  last_indexed_at?: string | null;
}

export interface RouteServiceFields {
  protocols: string[];
  capabilities: string[];
  encryption: { alg: string; publicKeyRef: string };
  payment: {
    model: string;
    price_per_kb_tokens: number;
    accepted_schemes: string[];
  };
  limits: { max_message_kb: number; offline_queue_ttl_seconds: number };
}

/** Returns default route metadata for the PlenipoAgent service block. */
export function defaultRouteServiceFields(): RouteServiceFields {
  return {
    protocols: ['plenipo.message.v1'],
    encryption: {
      alg: ENCRYPTION_ALG,
      publicKeyRef: '#enc-key',
    },
    payment: {
      model: 'per_kb',
      price_per_kb_tokens: 1,
      accepted_schemes: ['plenipo-prepaid-token'],
    },
    limits: {
      max_message_kb: 256,
      offline_queue_ttl_seconds: 86400,
    },
    capabilities: ['general', 'mcp'],
  };
}

/** Normalizes route metadata with defaults. */
export function normalizeRoute(raw: Partial<RouteServiceFields> = {}): RouteServiceFields {
  const defaults = defaultRouteServiceFields();

  return {
    protocols:
      Array.isArray(raw.protocols) && raw.protocols.length > 0
        ? raw.protocols.map(String)
        : defaults.protocols,
    capabilities:
      Array.isArray(raw.capabilities) && raw.capabilities.length > 0
        ? raw.capabilities.map(String)
        : defaults.capabilities,
    encryption: {
      alg: String(raw.encryption?.alg ?? defaults.encryption.alg),
      publicKeyRef: String(
        raw.encryption?.publicKeyRef ??
          (raw.encryption as { public_key_ref?: string } | undefined)?.public_key_ref ??
          defaults.encryption.publicKeyRef,
      ),
    },
    payment: {
      model: String(raw.payment?.model ?? defaults.payment.model),
      price_per_kb_tokens: Number(
        raw.payment?.price_per_kb_tokens ?? defaults.payment.price_per_kb_tokens,
      ),
      accepted_schemes:
        Array.isArray(raw.payment?.accepted_schemes) && raw.payment.accepted_schemes.length > 0
          ? raw.payment.accepted_schemes.map(String)
          : defaults.payment.accepted_schemes,
    },
    limits: {
      max_message_kb: Number(raw.limits?.max_message_kb ?? defaults.limits.max_message_kb),
      offline_queue_ttl_seconds: Number(
        raw.limits?.offline_queue_ttl_seconds ?? defaults.limits.offline_queue_ttl_seconds,
      ),
    },
  };
}

/** Validates route metadata; throws on invalid input. */
export function validateRoute(route: RouteServiceFields): void {
  if (route.protocols.length > MAX_PROTOCOLS || !route.protocols.every((p) => SUPPORTED_PROTOCOLS.has(p))) {
    throw new Error('invalid protocols');
  }
  if (!SUPPORTED_PAYMENT_MODELS.has(route.payment.model)) {
    throw new Error('invalid payment model');
  }
  if (
    route.payment.price_per_kb_tokens < 0 ||
    route.payment.price_per_kb_tokens > MAX_PRICE_PER_KB
  ) {
    throw new Error('invalid price_per_kb_tokens');
  }
  if (
    route.payment.accepted_schemes.length > MAX_SCHEMES ||
    !route.payment.accepted_schemes.every((s) => SUPPORTED_SCHEMES.has(s))
  ) {
    throw new Error('invalid accepted_schemes');
  }
  if (route.limits.max_message_kb < 1 || route.limits.max_message_kb > 1024) {
    throw new Error('invalid max_message_kb');
  }
  if (route.limits.offline_queue_ttl_seconds < 1 || route.limits.offline_queue_ttl_seconds > 604_800) {
    throw new Error('invalid offline_queue_ttl_seconds');
  }
  if (route.encryption.alg !== ENCRYPTION_ALG || !route.encryption.publicKeyRef) {
    throw new Error('invalid encryption');
  }
}

/** Patches the PlenipoAgent service block with route metadata. */
export function routeToDidServicePatch(
  document: Record<string, unknown>,
  route: RouteServiceFields,
  relayUrl?: string,
): Record<string, unknown> {
  const updated = structuredClone(document);
  const services = Array.isArray(updated.service) ? [...updated.service] : [];
  let found = false;

  for (let index = 0; index < services.length; index += 1) {
    const service = services[index];
    if (
      typeof service === 'object' &&
      service !== null &&
      (service as Record<string, unknown>).type === 'PlenipoAgent'
    ) {
      services[index] = {
        ...(service as Record<string, unknown>),
        serviceEndpoint:
          relayUrl ?? (service as Record<string, unknown>).serviceEndpoint,
        capabilities: route.capabilities,
        protocols: route.protocols,
        encryption: route.encryption,
        payment: route.payment,
        limits: route.limits,
      };
      found = true;
      break;
    }
  }

  if (!found) {
    services.push({
      id: `${String(updated.id)}#plenipo`,
      type: 'PlenipoAgent',
      serviceEndpoint: relayUrl,
      capabilities: route.capabilities,
      protocols: route.protocols,
      encryption: route.encryption,
      payment: route.payment,
      limits: route.limits,
    });
  }

  updated.service = services;
  return updated;
}

/** Extracts route metadata from a DID document. */
export function routeFromDocument(document: Record<string, unknown>): RouteServiceFields {
  const services = Array.isArray(document.service) ? document.service : [];
  for (const service of services) {
    if (
      typeof service === 'object' &&
      service !== null &&
      (service as Record<string, unknown>).type === 'PlenipoAgent'
    ) {
      const svc = service as Record<string, unknown>;
      return normalizeRoute({
        protocols: svc.protocols as string[] | undefined,
        capabilities: svc.capabilities as string[] | undefined,
        encryption: svc.encryption as RouteServiceFields['encryption'] | undefined,
        payment: svc.payment as RouteServiceFields['payment'] | undefined,
        limits: svc.limits as RouteServiceFields['limits'] | undefined,
      });
    }
  }
  return normalizeRoute({});
}

/** Normalizes a Registry search result into a Route Record. */
export function normalizeRouteRecord(raw: Record<string, unknown>): RouteRecord {
  const defaults = defaultRouteServiceFields();
  const payment = (raw.payment as Record<string, unknown> | undefined) ?? defaults.payment;
  const limits = (raw.limits as Record<string, unknown> | undefined) ?? defaults.limits;
  const encryption = (raw.encryption as Record<string, unknown> | undefined) ?? defaults.encryption;

  const encryptionRaw = encryption as Record<string, unknown>;
  return {
    did: String(raw.did ?? ''),
    document_url: String(raw.document_url ?? ''),
    service_endpoint:
      raw.service_endpoint === undefined || raw.service_endpoint === null
        ? undefined
        : String(raw.service_endpoint),
    protocols: Array.isArray(raw.protocols) ? raw.protocols.map(String) : defaults.protocols,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [],
    encryption: {
      alg: String(encryptionRaw.alg ?? ENCRYPTION_ALG),
      public_key_ref: String(
        encryptionRaw.public_key_ref ?? encryptionRaw.publicKeyRef ?? '#enc-key',
      ),
    },
    payment: {
      model: 'per_kb',
      price_per_kb_tokens: Number(payment.price_per_kb_tokens ?? 1),
      accepted_schemes: Array.isArray(payment.accepted_schemes)
        ? payment.accepted_schemes.map(String)
        : ['plenipo-prepaid-token'],
    },
    limits: {
      max_message_kb: Number(limits.max_message_kb ?? 256),
      offline_queue_ttl_seconds: Number(limits.offline_queue_ttl_seconds ?? 86400),
    },
    status:
      typeof raw.status === 'object' && raw.status !== null
        ? (raw.status as RouteRecord['status'])
        : { last_seen_at: null, delivery_success_rate: null },
    document_fingerprint:
      raw.document_fingerprint === undefined || raw.document_fingerprint === null
        ? null
        : String(raw.document_fingerprint),
    last_indexed_at:
      raw.last_indexed_at === undefined || raw.last_indexed_at === null
        ? null
        : String(raw.last_indexed_at),
  };
}

/** Updates route metadata locally and syncs the DID document with Core. */
export async function declareRoute(
  input: {
    protocols?: string[];
    capabilities?: string[];
    payment?: Partial<RouteServiceFields['payment']>;
    limits?: Partial<RouteServiceFields['limits']>;
  } = {},
  options?: { replace?: boolean; identity?: AgentIdentity },
): Promise<AgentIdentity> {
  const current = options?.identity ?? (await ensureIdentity());
  const existing = options?.replace ? normalizeRoute({}) : routeFromDocument(current.document);

  const merged = normalizeRoute({
    protocols: input.protocols ?? existing.protocols,
    capabilities: input.capabilities ?? existing.capabilities,
    payment: { ...existing.payment, ...input.payment },
    limits: { ...existing.limits, ...input.limits },
    encryption: existing.encryption,
  });
  validateRoute(merged);

  const document = routeToDidServicePatch(current.document, merged, current.relayUrl);
  const pending: AgentIdentity = {
    ...current,
    capabilities: merged.capabilities,
    document,
    registrationPending: true,
    documentFingerprint: documentFingerprint(document),
  };
  saveIdentity(pending);
  const [synced] = await syncIdentityWithCore(pending);
  return synced;
}

/** Public route view for MCP identity output. */
export function publicRouteView(document: Record<string, unknown>): RouteRecord {
  const route = routeFromDocument(document);
  return {
    did: String(document.id ?? ''),
    document_url: '',
    protocols: route.protocols,
    capabilities: route.capabilities,
    encryption: {
      alg: route.encryption.alg,
      public_key_ref: route.encryption.publicKeyRef,
    },
    payment: {
      model: 'per_kb',
      price_per_kb_tokens: route.payment.price_per_kb_tokens,
      accepted_schemes: route.payment.accepted_schemes,
    },
    limits: route.limits,
    status: { last_seen_at: null, delivery_success_rate: null },
  };
}
