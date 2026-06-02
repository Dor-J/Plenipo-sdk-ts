import { afterEach, describe, expect, it } from 'bun:test';
import { createDidDocument } from './create.js';
import { encPublicKeyFromDocument, fetchDidDocument, resolveEncPublicKey } from './resolve.js';

const originalFetch = globalThis.fetch;
const originalUnsafe = process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUnsafe === undefined) {
    delete process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH;
  } else {
    process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = originalUnsafe;
  }
});

describe('did resolve', () => {
  it('extracts X25519 key from generated document', async () => {
    const { did, document, privateKeys } = await createDidDocument('agent.example.com');
    const pub = encPublicKeyFromDocument(document, did);
    expect(pub.length).toBe(32);
    const { decodeBase64Url } = await import('../crypto/base64url.js');
    const secret = decodeBase64Url(privateKeys.encSecretKey);
    expect(secret.length).toBe(32);
  });

  it('rejects DID document id mismatch', async () => {
    const { did, document } = await createDidDocument('agent.example.com');
    const poisoned = { ...document, id: 'did:web:attacker.example.com' };

    expect(() => encPublicKeyFromDocument(poisoned, did)).toThrow(/id mismatch/);
  });

  it('rejects X25519 keys not referenced by keyAgreement', async () => {
    const { did, document } = await createDidDocument('agent.example.com');
    const poisoned = { ...document, keyAgreement: [] };

    expect(() => encPublicKeyFromDocument(poisoned, did)).toThrow(/keyAgreement|No encryption key/);
  });

  it('rejects unsafe caller-supplied document URLs', async () => {
    await expect(
      fetchDidDocument({
        recipientDid: 'did:web:agent.example.com',
        recipientDocumentUrl: 'http://127.0.0.1/.well-known/did.json',
      }),
    ).rejects.toThrow(/https|does not match/);
  });

  it('rejects https document URLs that do not match did:web URL', async () => {
    await expect(
      fetchDidDocument({
        recipientDid: 'did:web:agent.example.com',
        recipientDocumentUrl: 'https://other.example.com/.well-known/did.json',
      }),
    ).rejects.toThrow(/does not match/);
  });

  it('rejects direct fetch for unsupported DID methods', async () => {
    await expect(
      fetchDidDocument({
        recipientDid: 'did:key:z6MkTest',
        recipientDocumentUrl: 'https://agent.example.com/.well-known/did.json',
      }),
    ).rejects.toThrow(/Unsupported DID method/);
  });

  it('rejects missing verification methods', () => {
    expect(() => encPublicKeyFromDocument({ id: 'did:web:agent.example.com' }, 'did:web:agent.example.com'))
      .toThrow(/verificationMethod/);
  });

  it('rejects unsupported multibase key encoding', async () => {
    const { did, document } = await createDidDocument('agent.example.com');
    const methods = document.verificationMethod as Record<string, unknown>[];
    const poisoned = {
      ...document,
      verificationMethod: [
        {
          ...methods[1],
          publicKeyMultibase: 'not-base58btc',
        },
      ],
    };

    expect(() => encPublicKeyFromDocument(poisoned, did)).toThrow(/Unsupported publicKeyMultibase/);
  });

  it('skips non-object methods and wrong controllers', async () => {
    const { did, document } = await createDidDocument('agent.example.com');
    const methods = document.verificationMethod as Record<string, unknown>[];
    const poisoned = {
      ...document,
      verificationMethod: [
        'not-a-method',
        {
          ...methods[1],
          controller: 'did:web:attacker.example.com',
        },
      ],
    };

    expect(() => encPublicKeyFromDocument(poisoned, did)).toThrow(/No encryption key/);
  });

  it('rejects encryption methods without publicKeyMultibase', async () => {
    const { did, document } = await createDidDocument('agent.example.com');
    const methods = document.verificationMethod as Record<string, unknown>[];
    const poisoned = {
      ...document,
      verificationMethod: [{ ...methods[1], publicKeyMultibase: '' }],
    };

    expect(() => encPublicKeyFromDocument(poisoned, did)).toThrow(/publicKeyMultibase/);
  });

  it('rejects blocked direct document hosts', async () => {
    await expect(
      fetchDidDocument({
        recipientDid: 'did:web:127.0.0.1',
        recipientDocumentUrl: 'https://127.0.0.1/.well-known/did.json',
      }),
    ).rejects.toThrow(/blocked address/);
  });

  it('fetches a caller-supplied document URL when unsafe mode is enabled', async () => {
    const { did, document } = await createDidDocument('agent.example.com');
    process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = 'true';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(document), { status: 200 })) as unknown as typeof fetch;

    await expect(
      fetchDidDocument({
        recipientDid: did,
        recipientDocumentUrl: 'https://agent.example.com/.well-known/did.json',
      }),
    ).resolves.toEqual(document);
  });

  it('resolveEncPublicKey uses fetched direct document', async () => {
    const { did, document } = await createDidDocument('agent.example.com');
    process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = 'true';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(document), { status: 200 })) as unknown as typeof fetch;

    const key = await resolveEncPublicKey({
      recipientDid: did,
      recipientDocumentUrl: 'https://agent.example.com/.well-known/did.json',
    });

    expect(key.length).toBe(32);
  });

  it('uses registry discovery result before did:web fallback', async () => {
    const { did, document } = await createDidDocument('agent.example.com');
    const calls: string[] = [];
    process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = 'true';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/v1/search')) {
        return new Response(
          JSON.stringify({
            results: [{ did, document_url: 'https://agent.example.com/.well-known/did.json' }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(document), { status: 200 });
    }) as typeof fetch;

    await expect(fetchDidDocument({ recipientDid: did, registryUrl: 'https://registry.example' }))
      .resolves.toEqual(document);
    expect(calls[0]).toContain('/api/v1/search');
    expect(calls[1]).toBe('https://agent.example.com/.well-known/did.json');
  });

  it('uses spec path for path-based did:web fallback', async () => {
    const { did, document } = await createDidDocument('agents.example.com', {
      pathSegments: ['local', 'typescript-b'],
    });
    const calls: string[] = [];
    process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = 'true';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/v1/search')) return new Response('', { status: 503 });
      return new Response(JSON.stringify(document), { status: 200 });
    }) as typeof fetch;

    await expect(fetchDidDocument({ recipientDid: did })).resolves.toEqual(document);
    expect(calls[1]).toBe('https://agents.example.com/local/typescript-b/did.json');
  });

  it('falls back to relay resolver when registry and did:web fail', async () => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('/api/v1/search')) return new Response('', { status: 503 });
      return new Response(JSON.stringify({ id: 'did:key:z6MkTest' }), { status: 200 });
    }) as typeof fetch;

    await expect(
      fetchDidDocument({
        recipientDid: 'did:key:z6MkTest',
        relayHttpUrl: 'https://relay.example',
      }),
    ).resolves.toEqual({ id: 'did:key:z6MkTest' });
  });

  it('falls back from failed did:web fetch to relay resolver', async () => {
    const did = 'did:web:agent.example.com';
    process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = 'true';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('/api/v1/search')) return new Response('', { status: 503 });
      if (url.includes('/.well-known/did.json')) return new Response('', { status: 404 });
      return new Response(JSON.stringify({ id: did }), { status: 200 });
    }) as typeof fetch;

    await expect(
      fetchDidDocument({
        recipientDid: did,
        relayHttpUrl: 'https://relay.example',
      }),
    ).resolves.toEqual({ id: did });
  });

  it('validates public literal hosts without unsafe mode', async () => {
    const did = 'did:web:93.184.216.34';
    const document = {
      id: did,
      verificationMethod: [],
      keyAgreement: [],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(document), { status: 200 })) as unknown as typeof fetch;

    await expect(
      fetchDidDocument({
        recipientDid: did,
        recipientDocumentUrl: 'https://93.184.216.34/.well-known/did.json',
      }),
    ).resolves.toEqual(document);
  });

  it('propagates HTTP and JSON failures for direct document URLs', async () => {
    process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = 'true';
    globalThis.fetch = (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch;

    await expect(
      fetchDidDocument({
        recipientDid: 'did:web:agent.example.com',
        recipientDocumentUrl: 'https://agent.example.com/.well-known/did.json',
      }),
    ).rejects.toThrow(/404/);

    globalThis.fetch = (async () => new Response('not-json', { status: 200 })) as unknown as typeof fetch;
    await expect(
      fetchDidDocument({
        recipientDid: 'did:web:agent.example.com',
        recipientDocumentUrl: 'https://agent.example.com/.well-known/did.json',
      }),
    ).rejects.toThrow();
  });
});
