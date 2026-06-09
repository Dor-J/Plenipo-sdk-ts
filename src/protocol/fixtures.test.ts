import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRelayConnectUrl } from '../client/relayConnectUrl.js';
import { coreHostedDocumentUrl } from '../identity/urls.js';
import { defaultRouteServiceFields } from '../identity/route.js';
import { createDidDocument } from '../did/create.js';
import { eventsResponse } from '../sidecar/models.js';

const FIXTURES = join(import.meta.dir, '../../../test-fixtures/protocol/canonical.json');

interface CanonicalFixture {
  did: string;
  didDocumentUrl: string;
  relayWsBase: string;
  relayConnect: {
    nonce: string;
    signature: string;
    expectedQuerySuffix: string;
  };
  routeRecord: Record<string, unknown>;
  sidecarEventsResponse: {
    next_after_id: number;
    since_id: number;
  };
  ulidAlphabet: string;
  invalidUlidChars: string[];
}

function loadFixture(): CanonicalFixture {
  return JSON.parse(readFileSync(FIXTURES, 'utf8')) as CanonicalFixture;
}

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateUlid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  return Array.from(bytes, (byte) => ULID_ALPHABET[byte % 32]).join('');
}

describe('protocol fixtures', () => {
  test('relay connect URL matches canonical fixture', () => {
    const fixture = loadFixture();
    const url = buildRelayConnectUrl(fixture.relayWsBase, {
      did: fixture.did,
      nonce: fixture.relayConnect.nonce,
      signature: fixture.relayConnect.signature,
      didDocumentUrl: fixture.didDocumentUrl,
    });
    expect(url.endsWith(fixture.relayConnect.expectedQuerySuffix)).toBe(true);
  });

  test('DID document URL uses query form', () => {
    const did = 'did:web:localhost:agents:abc123';
    expect(coreHostedDocumentUrl('http://127.0.0.1:4000', did)).toBe(
      'http://127.0.0.1:4000/v1/dids?did=did%3Aweb%3Alocalhost%3Aagents%3Aabc123',
    );
  });

  test('route record matches fixture', () => {
    const fixture = loadFixture();
    const route = fixture.routeRecord as {
      protocols: string[];
      payment: { model: string; price_per_kb_tokens: number; accepted_schemes: string[] };
      limits: { max_message_kb: number; offline_queue_ttl_seconds: number };
      encryption: { alg: string; publicKeyRef: string };
    };
    const defaults = defaultRouteServiceFields();
    expect(defaults.protocols).toEqual(route.protocols);
    expect(defaults.payment).toEqual(route.payment);
    expect(defaults.limits).toEqual(route.limits);
    expect(defaults.encryption).toEqual(route.encryption);
  });

  test('multibase keys are single-z prefix', async () => {
    const created = await createDidDocument('localhost', {
      relayUrl: 'ws://127.0.0.1:4000/agent/websocket',
      pathSegments: ['agents', 'fixture'],
    });
    for (const method of created.document.verificationMethod as Array<{ publicKeyMultibase: string }>) {
      expect(method.publicKeyMultibase.startsWith('z')).toBe(true);
      expect(method.publicKeyMultibase.startsWith('zz')).toBe(false);
    }
  });

  test('ULID uses Crockford alphabet only', () => {
    const fixture = loadFixture();
    const pattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ulid = generateUlid();
      expect(pattern.test(ulid)).toBe(true);
      for (const ch of fixture.invalidUlidChars) {
        expect(ulid.includes(ch)).toBe(false);
      }
    }
  });

  test('sidecar events response shape matches fixture', () => {
    const fixture = loadFixture();
    const response = eventsResponse(
      [{ id: 1, type: 'message', envelope_id: '01JEXAMPLEULIDEXAMPLE12', has_plaintext: true }],
      2,
    );
    expect(response.next_after_id).toBe(fixture.sidecarEventsResponse.next_after_id);
    expect(response.since_id).toBe(fixture.sidecarEventsResponse.since_id);
    expect(Array.isArray(response.events)).toBe(true);
  });
});
