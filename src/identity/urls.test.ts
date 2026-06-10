import { describe, expect, it } from 'bun:test';
import {
  coreHostedDocumentUrl,
  externalDidWebDocumentUrl,
  isCoreHostedLocalDid,
  validateProductionDidWeb,
} from './urls.js';

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

describe('production did:web URL helpers', () => {
  it('derives external did:web document URLs', () => {
    expect(externalDidWebDocumentUrl('did:web:agent.example.com')).toBe(
      'https://agent.example.com/.well-known/did.json',
    );
    expect(externalDidWebDocumentUrl('did:web:agents.example.com:local:typescript-b')).toBe(
      'https://agents.example.com/local/typescript-b/did.json',
    );
  });

  it('validates production did:web URLs', () => {
    expect(() =>
      validateProductionDidWeb(
        'did:web:agents.example.com:local:typescript-b',
        'https://agents.example.com/local/typescript-b/did.json',
      ),
    ).not.toThrow();

    expect(() =>
      validateProductionDidWeb('did:web:agent.example.com', 'http://agent.example.com/.well-known/did.json'),
    ).toThrow('https');

    expect(() =>
      validateProductionDidWeb('did:web:agent.example.com', 'https://other.example.com/.well-known/did.json'),
    ).toThrow('DID document URL');

    expect(() => externalDidWebDocumentUrl('did:key:z6Mk')).toThrow('did:web');
  });

  it('detects dev-only Core-hosted local DIDs', () => {
    expect(isCoreHostedLocalDid('did:web:localhost:agents:abc')).toBe(true);
    expect(isCoreHostedLocalDid('did:web:agent.example.com')).toBe(false);
  });
});
