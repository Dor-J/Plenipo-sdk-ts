import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareCapabilities } from './capabilities.js';
import { identityFromCreateResult, saveIdentity } from './store.js';

describe('declareCapabilities', () => {
  const previousHome = process.env.PLENIPO_HOME;
  let tempHome = '';

  afterEach(() => {
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true });
      tempHome = '';
    }
    if (previousHome === undefined) {
      delete process.env.PLENIPO_HOME;
    } else {
      process.env.PLENIPO_HOME = previousHome;
    }
    mock.restore();
  });

  it('updates identity and re-registers with Core', async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'plenipo-cap-'));
    process.env.PLENIPO_HOME = tempHome;

    const calls: Array<Record<string, unknown>> = [];
    mock.module('./register.js', () => ({
      fetchAuthChallenge: async () => 'nonce',
      signChallengeNonce: () => 'signature',
      registerDocument: async (
        coreUrl: string,
        document: Record<string, unknown>,
        authSecretB64: string,
      ) => {
        calls.push({ coreUrl, document, authSecretB64 });
        return { type: 'did_registered', did: document.id };
      },
    }));

    const { declareCapabilities: declare } = await import('./capabilities.js');
    const identity = identityFromCreateResult({
      did: 'did:web:localhost:agents:cap',
      authSecretB64: 'AUTH',
      encSecretB64: 'ENC',
      didDocumentUrl: 'https://localhost/agents/cap/did.json',
      document: {
        id: 'did:web:localhost:agents:cap',
        service: [
          {
            type: 'PlenipoAgent',
            serviceEndpoint: 'ws://localhost:4000/agent/websocket',
            capabilities: ['general'],
          },
        ],
      },
      relayUrl: 'ws://localhost:4000/agent/websocket',
      registryUrl: 'http://localhost:4001',
      coreUrl: 'http://localhost:4000',
    });
    saveIdentity(identity);

    const updated = await declare(['web_search'], { identity });
    expect(updated.capabilities).toContain('web_search');
    expect(calls).toHaveLength(1);
  });
});
