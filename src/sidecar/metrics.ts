import type { PlenipoAgentRuntime } from '../runtime/agent.js';
import type { RuntimeStore } from '../runtime/store.js';
import { SERVICE_NAME, SIDECAR_VERSION } from './models.js';

export function renderSidecarMetrics(runtime: PlenipoAgentRuntime): string {
  const store = runtime.store as RuntimeStore;
  const lines: string[] = [];

  append(lines, 'plenipo_sidecar_build_info', 'Sidecar build information.', 'gauge', 1, {
    service: SERVICE_NAME,
    version: SIDECAR_VERSION,
  });
  append(lines, 'plenipo_sidecar_relay_connected', 'Relay WebSocket connection state.', 'gauge', runtime.getClient()?.connected ? 1 : 0);
  for (const [status, count] of Object.entries(store.countOutboxByStatus())) {
    append(lines, 'plenipo_sidecar_outbox_rows', 'Local outbox rows by status.', 'gauge', count, { status });
  }
  append(lines, 'plenipo_sidecar_receipts', 'Local persisted delivery receipts.', 'gauge', store.countReceipts());
  append(lines, 'plenipo_sidecar_inbox_messages', 'Encrypted-at-rest inbox rows.', 'gauge', store.countInboxMessages());
  append(lines, 'plenipo_sidecar_events_pending_delivery', 'Durable sidecar events not delivered to a local client.', 'gauge', store.countPendingSidecarEvents());
  for (const [eventType, count] of Object.entries(store.countSidecarEventsByType())) {
    append(lines, 'plenipo_sidecar_events', 'Durable sidecar events by type.', 'gauge', count, { event_type: eventType });
  }

  return `${lines.join('\n')}\n`;
}

function append(
  lines: string[],
  name: string,
  help: string,
  type: 'counter' | 'gauge',
  value: number,
  labels: Record<string, string> = {},
): void {
  if (!lines.includes(`# HELP ${name} ${help}`)) {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
  }
  const labelPairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, labelValue]) => `${key}="${escapeLabel(labelValue)}"`)
    .join(',');
  lines.push(`${name}${labelPairs ? `{${labelPairs}}` : ''} ${Number(value) || 0}`);
}

function escapeLabel(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
