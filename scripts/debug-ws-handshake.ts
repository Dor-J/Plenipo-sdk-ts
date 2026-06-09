import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureIdentity } from '../src/identity/provision.js';
import { PlenipoClient } from '../src/client/index.js';

function applyLocalDefaults(): void {
  if (process.platform === 'win32') {
    process.env.PLENIPO_CORE_URL ??= 'http://127.0.0.1:4000';
    process.env.PLENIPO_REGISTRY_URL ??= 'http://127.0.0.1:4001';
    process.env.PLENIPO_RELAY_URL ??= 'ws://127.0.0.1:4000/agent/websocket';
  }
}

async function main(): Promise<number> {
  applyLocalDefaults();
  process.env.PLENIPO_HOME = mkdtempSync(join(tmpdir(), 'plenipo-debug-ws-'));

  const coreUrl = process.env.PLENIPO_CORE_URL ?? 'http://127.0.0.1:4000';
  try {
    await fetch(`${coreUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(`Core unreachable at ${coreUrl}`);
    return 1;
  }

  const identity = await ensureIdentity();
  const challengeRes = await fetch(`${coreUrl.replace(/\/$/, '')}/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did: identity.did }),
  });
  if (!challengeRes.ok) {
    console.error(`auth/challenge failed: ${challengeRes.status}`);
    return 1;
  }

  console.log('attempting_connect...');

  const client = new PlenipoClient({
    did: identity.did,
    authSecretKey: identity.authSecretB64,
    didDocumentUrl: identity.didDocumentUrl,
    relayUrl: identity.relayUrl,
  });

  const timeoutMs = 45_000;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`connect timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    console.log('result: open');
    await client.disconnect();
    return 0;
  } catch (error) {
    console.log('result: error');
    console.log('error:', error instanceof Error ? error.message : String(error));
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
