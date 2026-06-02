import { describe, expect, test } from 'bun:test';
import * as ed from '@noble/ed25519';
import { base58btc } from 'multiformats/bases/base58';
import { createDidDocument } from './create.js';

describe('createDidDocument', () => {
  test('builds did:web with two verification methods', async () => {
    const { did, document } = await createDidDocument('agent.example.com');
    expect(did).toBe('did:web:agent.example.com');
    const vms = document.verificationMethod as Array<{ type: string }>;
    expect(vms).toHaveLength(2);
    const [service] = document.service as Array<{ type: string }>;
    expect(service?.type).toBe('PlenipoAgent');
  });

  test('builds path-based did:web documents', async () => {
    const { did, documentUrl, document } = await createDidDocument('agents.example.com', {
      pathSegments: ['local', 'typescript-b'],
    });

    expect(did).toBe('did:web:agents.example.com:local:typescript-b');
    expect(documentUrl).toBe('https://agents.example.com/local/typescript-b/did.json');
    expect(document.id).toBe(did);
  });

  test('returns a 32-byte auth seed matching the document public key', async () => {
    const { document, privateKeys } = await createDidDocument('agent.example.com');
    const authSeed = Buffer.from(privateKeys.authSecretKey, 'base64url');
    expect(authSeed).toHaveLength(32);

    const [authMethod] = document.verificationMethod as Array<{ publicKeyMultibase: string }>;
    expect(authMethod).toBeDefined();
    if (!authMethod) throw new Error('missing auth verification method');
    const encodedPublic = base58btc.decode(authMethod.publicKeyMultibase.slice(1));
    const publicKey = encodedPublic.slice(2);

    expect(await ed.getPublicKeyAsync(authSeed)).toEqual(publicKey);
  });
});
