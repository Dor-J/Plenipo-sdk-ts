import { describe, expect, it } from 'bun:test';
import { encodeBase64Url } from './base64url.js';
import { buildSigningInput } from './signingInput.js';

describe('buildSigningInput', () => {
  it('builds the canonical signing input for a known envelope', async () => {
    const ciphertext = new TextEncoder().encode('ciphertext-bytes');
    const digest = await crypto.subtle.digest('SHA-256', ciphertext);
    const hashLine = encodeBase64Url(new Uint8Array(digest));

    const input = buildSigningInput({
      v: '1.0',
      envelope_id: '01JTEST',
      sender_did: 'did:web:sender.local',
      recipient_did: 'did:web:recipient.local',
      created_at: '2026-06-01T00:00:00Z',
      ciphertext: encodeBase64Url(ciphertext),
    });

    expect(new TextDecoder().decode(input)).toBe(
      [
        '1.0',
        '01JTEST',
        'did:web:sender.local',
        'did:web:recipient.local',
        '2026-06-01T00:00:00Z',
        hashLine,
      ].join('\n'),
    );
  });
});
