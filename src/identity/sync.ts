import { documentFingerprint } from './registerSigning.js';
import { registerDocument } from './register.js';
import { saveIdentity, type AgentIdentity } from './store.js';
import { syncWarningsFromError } from './syncErrors.js';

export interface SyncIdentityResult {
  ok: boolean;
  did: string;
  coreRegistered: boolean;
  registrationPending: boolean;
  documentFingerprint: string | null;
  warnings: string[];
}

/** Registers or updates the identity DID document with Core. */
export async function syncIdentityWithCore(
  identity: AgentIdentity,
): Promise<[AgentIdentity, SyncIdentityResult]> {
  const warnings: string[] = [];
  const fingerprint = documentFingerprint(identity.document);

  try {
    const response = await registerDocument(
      identity.coreUrl,
      identity.document,
      identity.authSecretB64,
    );
    const updated: AgentIdentity = {
      ...identity,
      coreRegistered: true,
      registrationPending: false,
      lastRegistrationError: null,
      documentFingerprint: String(response.document_fingerprint ?? fingerprint),
    };
    saveIdentity(updated);
    return [
      updated,
      {
        ok: true,
        did: updated.did,
        coreRegistered: true,
        registrationPending: false,
        documentFingerprint: updated.documentFingerprint,
        warnings,
      },
    ];
  } catch (error) {
    const pending: AgentIdentity = {
      ...identity,
      coreRegistered: false,
      registrationPending: true,
      lastRegistrationError: error instanceof Error ? error.message : String(error),
      documentFingerprint: fingerprint,
    };
    saveIdentity(pending);
    warnings.push(...syncWarningsFromError(error));
    return [
      pending,
      {
        ok: false,
        did: pending.did,
        coreRegistered: false,
        registrationPending: true,
        documentFingerprint: fingerprint,
        warnings,
      },
    ];
  }
}

/** Serializes a sync result for MCP tool responses. */
export function syncResultToDict(result: SyncIdentityResult): Record<string, unknown> {
  return {
    ok: result.ok,
    did: result.did,
    core_registered: result.coreRegistered,
    registration_pending: result.registrationPending,
    document_fingerprint: result.documentFingerprint,
    warnings: result.warnings,
  };
}
