import { ensureIdentity } from './provision.js';
import { documentFingerprint } from './registerSigning.js';
import { syncIdentityWithCore } from './sync.js';
import { saveIdentity, type AgentIdentity } from './store.js';

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

function updateDocumentCapabilities(
  document: Record<string, unknown>,
  capabilities: string[],
  replace: boolean,
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
      const existing = Array.isArray((service as Record<string, unknown>).capabilities)
        ? ((service as Record<string, unknown>).capabilities as string[])
        : [];
      const merged = replace ? capabilities : [...new Set([...existing, ...capabilities])];
      services[index] = { ...(service as Record<string, unknown>), capabilities: merged };
      found = true;
      break;
    }
  }

  if (!found) {
    services.push({
      id: `${String(updated.id)}#plenipo`,
      type: 'PlenipoAgent',
      capabilities,
    });
  }

  updated.service = services;
  return updated;
}

/** Updates capabilities locally and syncs the DID document with Core. */
export async function declareCapabilities(
  capabilities: string[],
  options?: { replace?: boolean; identity?: AgentIdentity },
): Promise<AgentIdentity> {
  const current = options?.identity ?? (await ensureIdentity());
  const document = updateDocumentCapabilities(
    current.document,
    capabilities,
    options?.replace ?? false,
  );

  const pending: AgentIdentity = {
    ...current,
    capabilities: capabilitiesFromDocument(document),
    document,
    registrationPending: true,
    documentFingerprint: documentFingerprint(document),
  };
  saveIdentity(pending);
  const [synced] = await syncIdentityWithCore(pending);
  return synced;
}
