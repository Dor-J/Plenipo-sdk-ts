import { describe, expect, it } from 'bun:test';
import { createDidDocument } from './create.js';
import { encPublicKeyFromDocument } from './resolve.js';

describe('did resolve', () => {
  it('extracts X25519 key from generated document', async () => {
    const { did, document, privateKeys } = await createDidDocument('agent.example.com');
    const pub = encPublicKeyFromDocument(document, did);
    expect(pub.length).toBe(32);
    const { decodeBase64Url } = await import('../crypto/base64url.js');
    const secret = decodeBase64Url(privateKeys.encSecretKey);
    expect(secret.length).toBe(32);
  });
});
