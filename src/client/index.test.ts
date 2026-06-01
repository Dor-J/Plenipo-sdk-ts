import { describe, expect, test } from 'bun:test';
import { PlenipoClient } from './index.js';

const baseOptions = {
  did: 'did:web:agent.example.com',
  authSecretKey: Buffer.alloc(32).toString('base64url'),
  didDocumentUrl: 'https://agent.example.com/.well-known/did.json',
};

describe('PlenipoClient relay URL handling', () => {
  test('derives https auth origin from wss relay URL', () => {
    const client = new PlenipoClient({
      ...baseOptions,
      relayUrl: 'wss://relay.example.com/agent/websocket',
    });

    expect(client.relayHttpUrl).toBe('https://relay.example.com');
  });

  test('allows insecure ws only for local development by default', () => {
    const client = new PlenipoClient({
      ...baseOptions,
      relayUrl: 'ws://localhost:4000/agent/websocket',
    });

    expect(client.relayHttpUrl).toBe('http://localhost:4000');
    expect(
      () =>
        new PlenipoClient({
          ...baseOptions,
          relayUrl: 'ws://relay.example.com/agent/websocket',
        }),
    ).toThrow('Insecure ws:// relayUrl is allowed only for localhost');
  });
});
