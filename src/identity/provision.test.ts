import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureIdentity, identityToMcpConfig } from './provision.js';
import { loadIdentity } from './store.js';

describe('identity provision', () => {
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

  it('creates local identity offline without Core', async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'plenipo-offline-'));
    process.env.PLENIPO_HOME = tempHome;

    const { createLocalIdentity } = await import('./provision.js');
    const { coreHostedDocumentUrl } = await import('./urls.js');
    const identity = await createLocalIdentity({ coreUrl: 'http://core.local' });

    expect(identity.did.startsWith('did:web:localhost:agents:')).toBe(true);
    expect(identity.didDocumentUrl).toBe(coreHostedDocumentUrl('http://core.local', identity.did));
    expect(identity.coreRegistered).toBe(false);
    expect(identity.registrationPending).toBe(true);
    expect(loadIdentity()).not.toBeNull();
  });

  it('provisions and persists identity', async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'plenipo-provision-'));
    process.env.PLENIPO_HOME = tempHome;

    const calls: Array<Record<string, unknown>> = [];
    mock.module('./register.js', () => ({
      fetchAuthChallenge: async () => 'nonce',
      registerDocument: async (
        coreUrl: string,
        document: Record<string, unknown>,
        authSecretB64: string,
      ) => {
        calls.push({ coreUrl, document, authSecretB64 });
        return { type: 'did_registered', did: document.id, document_fingerprint: 'fp' };
      },
    }));

    const { provisionIdentity: provision } = await import('./provision.js');
    const identity = await provision({
      coreUrl: 'http://core.local',
      relayUrl: 'ws://core.local/agent/websocket',
      registryUrl: 'http://registry.local',
    });

    expect(identity.did.startsWith('did:web:localhost:agents:')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(loadIdentity()).not.toBeNull();
  });

  it('prefers env identity over file', async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'plenipo-provision-env-'));
    process.env.PLENIPO_HOME = tempHome;
    process.env.PLENIPO_DID = 'did:web:env.local';
    process.env.PLENIPO_AUTH_SECRET_B64 = 'AUTH';
    process.env.PLENIPO_DID_DOCUMENT_URL = 'https://env.local/.well-known/did.json';

    const identity = await ensureIdentity();
    expect(identity.did).toBe('did:web:env.local');
  });

  it('maps identity to MCP config', () => {
    process.env.PLENIPO_DID = 'did:web:env.local';
    process.env.PLENIPO_AUTH_SECRET_B64 = 'AUTH';
    process.env.PLENIPO_DID_DOCUMENT_URL = 'https://env.local/.well-known/did.json';

    const identity = {
      did: 'did:web:env.local',
      authSecretB64: 'AUTH',
      encSecretB64: 'ENC',
      didDocumentUrl: 'https://env.local/.well-known/did.json',
      relayUrl: 'ws://localhost:4000/agent/websocket',
      registryUrl: 'http://localhost:4001',
      coreUrl: 'http://localhost:4000',
      capabilities: ['general'],
      createdAt: '2026-01-01T00:00:00.000Z',
      document: { id: 'did:web:env.local' },
    };
    const config = identityToMcpConfig(identity);
    expect(config.did).toBe(identity.did);
    expect(config.authSecretB64).toBe(identity.authSecretB64);
  });
});
