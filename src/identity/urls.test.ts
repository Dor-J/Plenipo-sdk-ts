import { describe, expect, it } from 'bun:test';
import { coreHostedDocumentUrl } from './urls.js';

describe('coreHostedDocumentUrl', () => {
  it('uses a query param for the Core resolver URL', () => {
    const did = 'did:web:localhost:agents:abc123';
    const url = coreHostedDocumentUrl('http://localhost:4000', did);
    expect(url).toBe(
      'http://localhost:4000/v1/dids?did=did%3Aweb%3Alocalhost%3Aagents%3Aabc123',
    );
  });

  it('strips trailing slash from core URL', () => {
    const url = coreHostedDocumentUrl('http://localhost:4000/', 'did:web:localhost:agents:test');
    expect(url.startsWith('http://localhost:4000/v1/dids?did=')).toBe(true);
  });
});
