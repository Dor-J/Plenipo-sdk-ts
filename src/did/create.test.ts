import { describe, expect, test } from 'bun:test';
import * as ed from '@noble/ed25519';
import { base58btc } from 'multiformats/bases/base58';
import { createDidDocument } from './create.js';

describe('createDidDocument', () => {
  test('includes default Route Record metadata on PlenipoAgent service', async () => {
    const { document } = await createDidDocument('agent.example.com');
    const [service] = document.service as Array<Record<string, unknown>>;
    expect(service?.type).toBe('PlenipoAgent');
    expect(service?.protocols).toEqual(['plenipo.message.v1']);
    expect(service?.payment).toEqual({
      model: 'per_kb',
      price_per_kb_tokens: 1,
      accepted_schemes: ['plenipo-dev-token'],
    });
    expect(service?.limits).toEqual({
      max_message_kb: 256,
      offline_queue_ttl_seconds: 86400,
    });
    expect(service?.encryption).toEqual({
      alg: 'x25519-xsalsa20poly1305',
      publicKeyRef: '#enc-key',
    });
  });

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
    expect(authMethod.publicKeyMultibase.startsWith('z')).toBe(true);
    expect(authMethod.publicKeyMultibase.startsWith('zz')).toBe(false);
    const encodedPublic = base58btc.decode(authMethod.publicKeyMultibase);
    const publicKey = encodedPublic.slice(2);

    expect(await ed.getPublicKeyAsync(authSeed)).toEqual(publicKey);
  });

  test('emits single-z multibase encryption keys compatible with Core', async () => {
    const { document } = await createDidDocument('localhost', {
      pathSegments: ['agents', 'multibase-test'],
    });
    const encMethod = (document.verificationMethod as Array<{ type: string; publicKeyMultibase: string }>).find(
      (method) => method.type === 'X25519KeyAgreementKey2020',
    );
    expect(encMethod).toBeDefined();
    if (!encMethod) {
      throw new Error('missing encryption verification method');
    }
    expect(encMethod.publicKeyMultibase.startsWith('z')).toBe(true);
    expect(encMethod.publicKeyMultibase.startsWith('zz')).toBe(false);
    expect(encMethod.publicKeyMultibase.length).toBe(48);
  });
});
