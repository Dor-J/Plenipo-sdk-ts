import { describe, expect, it } from 'bun:test';
import { createDidDocument } from './create.js';
import { encPublicKeyFromDocument, fetchDidDocument } from './resolve.js';

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
});
