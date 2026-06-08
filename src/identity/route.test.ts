import { describe, expect, it } from 'bun:test';
import {
  normalizeRoute,
  normalizeRouteRecord,
  routeFromDocument,
  routeToDidServicePatch,
  validateRoute,
} from '../identity/route.js';

describe('route metadata', () => {
  it('applies defaults', () => {
    const route = normalizeRoute({});
    expect(route.protocols).toEqual(['plenipo.message.v1']);
    expect(route.payment.model).toBe('per_kb');
  });

  it('rejects invalid protocol', () => {
    const route = normalizeRoute({ protocols: ['bad.protocol'] });
    expect(() => validateRoute(route)).toThrow('invalid protocols');
  });

  it('patches PlenipoAgent service block', () => {
    const document = {
      id: 'did:web:localhost:agents:abc',
      service: [
        {
          id: 'did:web:localhost:agents:abc#plenipo',
          type: 'PlenipoAgent',
          capabilities: ['general'],
        },
      ],
    };
    const route = normalizeRoute({ capabilities: ['general', 'mcp'] });
    const updated = routeToDidServicePatch(document, route, 'ws://localhost:4000/agent/websocket');
    const service = (updated.service as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(service.protocols).toEqual(['plenipo.message.v1']);
  });

  it('normalizes registry search records', () => {
    const record = normalizeRouteRecord({
      did: 'did:web:localhost:agents:abc',
      document_url: 'http://localhost:4000/v1/dids/abc',
      capabilities: ['mcp'],
      encryption: { alg: 'x25519-xsalsa20poly1305', public_key_ref: '#enc-key' },
      payment: {
        model: 'per_kb',
        price_per_kb_tokens: 1,
        accepted_schemes: ['plenipo-dev-token'],
      },
      limits: { max_message_kb: 256, offline_queue_ttl_seconds: 86400 },
    });
    expect(record.payment.accepted_schemes).toEqual(['plenipo-dev-token']);
  });

  it('extracts route from DID document', () => {
    const document = {
      id: 'did:web:localhost:agents:abc',
      service: [
        {
          type: 'PlenipoAgent',
          protocols: ['plenipo.message.v1'],
          capabilities: ['general', 'mcp'],
          payment: {
            model: 'per_kb',
            price_per_kb_tokens: 1,
            accepted_schemes: ['plenipo-dev-token'],
          },
        },
      ],
    };
    const route = routeFromDocument(document);
    expect(route.protocols).toEqual(['plenipo.message.v1']);
    expect(route.capabilities).toEqual(['general', 'mcp']);
  });
});
