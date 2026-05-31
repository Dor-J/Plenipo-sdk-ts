import { describe, expect, it } from 'bun:test';
import { McpRuntime, type BufferedMessage } from './runtime.js';

describe('McpRuntime', () => {
  it('drainMessages respects since and limit', () => {
    const runtime = new McpRuntime({
      did: 'did:web:test.local',
      authSecretB64: 'AAAA',
      didDocumentUrl: 'https://test.local/.well-known/did.json',
      relayUrl: 'ws://localhost:4000/agent/websocket',
    });

    const buf = (runtime as unknown as { buffer: BufferedMessage[] }).buffer;
    buf.push(
      {
        kind: 'deliver',
        envelope_id: '01A',
        receivedAt: '2026-01-01T00:00:00Z',
      },
      {
        kind: 'deliver',
        envelope_id: '01B',
        receivedAt: '2026-06-01T00:00:00Z',
      },
    );

    const drained = runtime.drainMessages('2026-02-01T00:00:00Z', 10);
    expect(drained).toHaveLength(1);
    expect(drained[0]?.envelope_id).toBe('01B');
    expect(buf).toHaveLength(1);
    expect(buf[0]?.envelope_id).toBe('01A');
  });
});
