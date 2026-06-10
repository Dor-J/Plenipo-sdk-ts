import { describe, expect, it } from 'bun:test';
import { RuntimeStore } from '../runtime/store.js';
import { renderSidecarMetrics } from './metrics.js';

describe('sidecar metrics', () => {
  it('renders sanitized local Prometheus metrics', () => {
    const store = new RuntimeStore(':memory:');
    store.insertOutboxPending({
      envelopeId: '01METRIC',
      recipientDid: 'did:web:localhost:agents:peer',
    });
    store.insertSidecarEvent({
      eventType: 'message',
      envelopeId: '01METRIC',
      payload: { plaintext: 'super-secret-local-message' },
    });

    const runtime = {
      store,
      getClient: () => ({ connected: true }),
    } as never;

    const text = renderSidecarMetrics(runtime);

    expect(text).toContain('plenipo_sidecar_build_info');
    expect(text).toContain('plenipo_sidecar_relay_connected 1');
    expect(text).toContain('plenipo_sidecar_outbox_rows{status="pending"} 1');
    expect(text).toContain('plenipo_sidecar_events{event_type="message"} 1');
    expect(text).not.toContain('super-secret-local-message');
    store.close();
  });
});
