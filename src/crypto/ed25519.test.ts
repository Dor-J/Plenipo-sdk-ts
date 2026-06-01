import { describe, expect, it } from 'bun:test';
import * as ed from '@noble/ed25519';
import { decodeBase64Url } from './base64url.js';
import { sign, verify } from './ed25519.js';

describe('ed25519', () => {
  it('signs and verifies detached signatures', async () => {
    const secretKey = new Uint8Array(32).fill(7);
    const publicKey = await ed.getPublicKeyAsync(secretKey);
    const message = new TextEncoder().encode('plenipo signing vector');

    const signature = decodeBase64Url(await sign(message, secretKey));

    expect(signature.length).toBe(64);
    expect(await verify(message, signature, publicKey)).toBe(true);
    expect(await verify(new TextEncoder().encode('tampered'), signature, publicKey)).toBe(false);
  });
});
