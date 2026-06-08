import {
  buildRegisterPayload,
  signRegisterPayload,
} from './registerSigning.js';

/** Requests a relay auth challenge nonce for proof-of-possession. */
export async function fetchAuthChallenge(coreUrl: string, did: string): Promise<string> {
  const response = await fetch(`${coreUrl.replace(/\/$/, '')}/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ did }),
  });
  if (!response.ok) {
    throw new Error(`challenge failed with status ${response.status}`);
  }
  const body = (await response.json()) as { nonce?: string };
  if (!body.nonce) {
    throw new Error('challenge response missing nonce');
  }
  return body.nonce;
}

/** Registers or updates a DID document with Core-hosted storage. */
export async function registerDocument(
  coreUrl: string,
  document: Record<string, unknown>,
  authSecretB64: string,
): Promise<Record<string, unknown>> {
  const did = String(document.id);
  const nonce = await fetchAuthChallenge(coreUrl, did);
  const payload = buildRegisterPayload({ nonce, did, document });
  const signature = signRegisterPayload(payload, authSecretB64);
  const response = await fetch(`${coreUrl.replace(/\/$/, '')}/v1/dids`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      document,
      nonce,
      timestamp: payload.timestamp,
      signature,
    }),
  });
  if (!response.ok) {
    throw new Error(`register failed with status ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}
