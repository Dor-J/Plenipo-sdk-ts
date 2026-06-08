import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  identityFromCreateResult,
  loadIdentity,
  saveIdentity,
} from './store.js';

describe('identity store', () => {
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
  });

  it('roundtrips identity.json', () => {
    tempHome = mkdtempSync(join(tmpdir(), 'plenipo-identity-'));
    process.env.PLENIPO_HOME = tempHome;

    const identity = identityFromCreateResult({
      did: 'did:web:localhost:agents:abc',
      authSecretB64: 'AUTH',
      encSecretB64: 'ENC',
      didDocumentUrl: 'https://localhost/agents/abc/did.json',
      document: { id: 'did:web:localhost:agents:abc', service: [] },
      relayUrl: 'ws://localhost:4000/agent/websocket',
      registryUrl: 'http://localhost:4001',
      coreUrl: 'http://localhost:4000',
      capabilities: ['general'],
    });

    saveIdentity(identity);
    const loaded = loadIdentity();
    expect(loaded?.did).toBe(identity.did);
    expect(loaded?.authSecretB64).toBe('AUTH');
    expect(readFileSync(join(tempHome, 'identity.json'), 'utf8')).toContain('"did"');
  });
});
