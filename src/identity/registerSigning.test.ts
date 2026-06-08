import { describe, expect, it } from 'bun:test';
import {
  buildRegisterPayload,
  documentFingerprint,
  signingBytes,
} from './registerSigning.js';

describe('registerSigning', () => {
  it('sorts nested document keys for fingerprinting', () => {
    const document = {
      service: [{ capabilities: ['general'], type: 'PlenipoAgent' }],
      id: 'did:web:localhost:agents:test',
      verificationMethod: [],
    };
    const reordered = {
      id: document.id,
      verificationMethod: [],
      service: [{ type: 'PlenipoAgent', capabilities: ['general'] }],
    };
    expect(documentFingerprint(document)).toBe(documentFingerprint(reordered));
  });

  it('builds canonical register payload', () => {
    const document = { id: 'did:web:localhost:agents:test', service: [] };
    const payload = buildRegisterPayload({
      nonce: 'nonce',
      did: 'did:web:localhost:agents:test',
      document,
      timestamp: '2026-06-08T12:00:00Z',
    });
    expect(payload.type).toBe('plenipo.did.register');
    expect(payload.document_fingerprint).toBe(documentFingerprint(document));
    expect(new TextDecoder().decode(signingBytes(payload))).toContain(
      '"timestamp":"2026-06-08T12:00:00Z"',
    );
  });
});
