import { describe, expect, test } from 'bun:test';
import { coreHostedDocumentUrl } from '../identity/urls.js';
import { buildRelayConnectUrl, relayWsBaseUrl } from './relayConnectUrl.js';

describe('buildRelayConnectUrl', () => {
  test('uses query-form DID document URL without double encoding', () => {
    const did = 'did:web:localhost:agents:abc123';
    const didDocumentUrl = coreHostedDocumentUrl('http://127.0.0.1:4000', did);
    const url = buildRelayConnectUrl('ws://127.0.0.1:4000/agent/websocket', {
      did,
      nonce: 'nonce-value',
      signature: 'sig_value',
      didDocumentUrl,
    });

    expect(url.startsWith('ws://127.0.0.1:4000/agent/websocket?')).toBe(true);
    expect(url).toContain('did_document_url=http%3A%2F%2F127.0.0.1%3A4000%2Fv1%2Fdids%3Fdid%3D');
    expect(url).toContain('did%253Aweb%253Alocalhost%253Aagents%253Aabc123');
    expect(url).not.toContain('/v1/dids/did%3Aweb');
    expect(url.endsWith('&vsn=2.0.0')).toBe(true);
    expect(url).not.toMatch(/^[^?]*\?vsn=2\.0\.0&/);
  });

  test('strips pre-existing query params from relay base URL', () => {
    expect(relayWsBaseUrl('ws://localhost:4000/agent/websocket?vsn=2.0.0')).toBe(
      'ws://localhost:4000/agent/websocket',
    );
  });
});
