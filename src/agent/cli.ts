import { existsSync } from 'node:fs';
import { ensureIdentity } from '../identity/provision.js';
import { syncIdentityWithCore } from '../identity/sync.js';
import { PlenipoAgentRuntime } from '../runtime/agent.js';
import type { AgentEvent } from '../runtime/events.js';
import { loadRuntimeState } from '../runtime/state.js';
import { RuntimeStore } from '../runtime/store.js';
import { readSidecarTokenFile, sidecarTokenPath } from '../sidecar/auth.js';
import { DEFAULT_SIDECAR_CONFIG, validateBindHost, validateNoAuthBind } from '../sidecar/config.js';
import { runSidecar } from '../sidecar/server.js';

function applyLocalDefaults(): void {
  if (process.platform === 'win32') {
    process.env.PLENIPO_CORE_URL ??= 'http://127.0.0.1:4000';
    process.env.PLENIPO_REGISTRY_URL ??= 'http://127.0.0.1:4001';
    process.env.PLENIPO_RELAY_URL ??= 'ws://127.0.0.1:4000/agent/websocket';
  }
}

function documentHasRoute(document: Record<string, unknown>): boolean {
  const services = Array.isArray(document.service) ? document.service : [];
  for (const service of services) {
    if (
      typeof service === 'object' &&
      service !== null &&
      (service as Record<string, unknown>).type === 'PlenipoAgent' &&
      (service as Record<string, unknown>).protocols
    ) {
      return true;
    }
  }
  return false;
}

function printEvent(
  event: AgentEvent,
  options: { printEvents: boolean; printPlaintext: boolean },
): void {
  if (event.type === 'connect' && options.printEvents) {
    console.log(`[connect] did=${event.did}`);
    return;
  }
  if (event.type === 'disconnect' && options.printEvents) {
    console.log(`[disconnect] reason=${event.reason}`);
    return;
  }
  if (event.type === 'error' && options.printEvents) {
    console.log(`[error] ${event.message}`);
    return;
  }
  if (event.type === 'message') {
    console.log(`[message] envelope_id=${event.envelopeId} sender=${event.senderDid}`);
    if (options.printPlaintext && event.plaintext !== null) {
      console.log(event.plaintext);
    }
    return;
  }
  if (event.type === 'delivery_receipt') {
    const source = event.recovered ? 'recovered' : 'live';
    console.log(
      `[receipt] envelope_id=${event.envelopeId} bytes=${event.ciphertextBytes} ` +
        `kb=${event.billableKb} tokens=${event.chargedTokens} ` +
        `balance_after=${event.balanceAfter} source=${source}`,
    );
  }
}

async function runAgent(args: CliArgs): Promise<number> {
  applyLocalDefaults();
  const runtime = new PlenipoAgentRuntime();
  await runtime.runWithReconnect();
  console.log('[ready] agent runtime connected');

  const printEvents = Boolean(args['print-events']);
  const printPlaintext = Boolean(args['print-plaintext']);

  process.on('SIGINT', () => {
    void runtime.close().finally(() => process.exit(0));
  });

  for await (const event of runtime.events()) {
    printEvent(event, { printEvents, printPlaintext });
  }
  return 0;
}

async function showStatus(): Promise<number> {
  applyLocalDefaults();
  const store = new RuntimeStore();
  try {
    const identity = await ensureIdentity();
    const [synced] = await syncIdentityWithCore(identity);
    const state = loadRuntimeState(store);
    const counts = store.countOutboxByStatus();

    let connected = false;
    const runtime = new PlenipoAgentRuntime(store);
    try {
      await runtime.ensureReady();
      connected = Boolean(runtime.getClient()?.connected);
      await runtime.close();
    } catch {
      connected = false;
      await runtime.close().catch(() => undefined);
    }

    console.log(`did: ${synced.did}`);
    console.log(`core_registered: ${String(synced.coreRegistered).toLowerCase()}`);
    console.log(`route_declared: ${String(documentHasRoute(synced.document)).toLowerCase()}`);
    console.log(`connected: ${String(connected).toLowerCase()}`);
    console.log(`outbox_pending: ${counts.pending ?? 0}`);
    console.log(`outbox_accepted: ${counts.accepted ?? 0}`);
    console.log(`outbox_delivered: ${counts.delivered ?? 0}`);
    console.log(`outbox_failed: ${counts.failed ?? 0}`);
    const cursor = state.lastReceiptCursor ?? state.lastReceiptSeenAt ?? '';
    console.log(`last_receipt_cursor: ${cursor}`);
    return 0;
  } finally {
    store.close();
  }
}

function showOutbox(): number {
  const store = new RuntimeStore();
  try {
    for (const row of store.listOutbox({ limit: 100 })) {
      console.log(
        `${row.envelopeId} status=${row.status} recipient=${row.recipientDid} ` +
          `tokens=${row.chargedTokens} delivered_at=${row.deliveredAt}`,
      );
    }
    return 0;
  } finally {
    store.close();
  }
}

function showReceipts(): number {
  const store = new RuntimeStore();
  try {
    for (const row of store.listReceipts(100)) {
      console.log(
        `${row.envelopeId} tokens=${row.chargedTokens} bytes=${row.ciphertextBytes} ` +
          `delivered_at=${row.deliveredAt}`,
      );
    }
    return 0;
  } finally {
    store.close();
  }
}

async function showEvents(args: CliArgs): Promise<number> {
  const { PlenipoSidecarClient } = await import('../sidecar/client.js');
  const client = await PlenipoSidecarClient.fromEnv();
  const afterId = Number(args['after-id'] ?? 0);
  const timeoutMs = Number(args['timeout-ms'] ?? 1000);
  const limit = Number(args.limit ?? 100);
  const printPlaintext = Boolean(args['print-plaintext']);
  const body = await client.events({
    afterId,
    timeoutMs,
    limit,
    includePlaintext: printPlaintext,
  });
  const events = Array.isArray(body.events) ? body.events : [];
  for (const event of events) {
    if (!event || typeof event !== 'object') {
      continue;
    }
    const row = event as Record<string, unknown>;
    if (row.type === 'message') {
      console.log(
        `[message] id=${row.id} envelope_id=${row.envelope_id} sender=${row.sender_did}`,
      );
      if (printPlaintext && row.plaintext !== undefined) {
        console.log(String(row.plaintext));
      }
    } else if (row.type === 'delivery_receipt') {
      console.log(
        `[receipt] id=${row.id} envelope_id=${row.envelope_id} tokens=${row.charged_tokens}`,
      );
    }
  }
  return 0;
}

function showInbox(): number {
  const store = new RuntimeStore();
  try {
    for (const row of store.listInbox(100)) {
      console.log(
        `${row.envelopeId} sender=${row.senderDid} received_at=${row.receivedAt} has_plaintext=true`,
      );
    }
    return 0;
  } finally {
    store.close();
  }
}

function showSidecarToken(args: CliArgs): number {
  const path = sidecarTokenPath();
  const exists = existsSync(path);
  console.log(`Token file: ${path}`);
  console.log(`Exists: ${String(exists).toLowerCase()}`);
  if (args.show) {
    console.warn('WARNING: displaying sidecar bearer token');
    if (exists) {
      const token = readSidecarTokenFile(path);
      if (token) {
        console.log(token);
      }
    }
  }
  return 0;
}

async function runSidecarCommand(args: CliArgs): Promise<number> {
  applyLocalDefaults();
  const config = {
    ...DEFAULT_SIDECAR_CONFIG,
    host: String(args.host ?? DEFAULT_SIDECAR_CONFIG.host),
    port: Number(args.port ?? DEFAULT_SIDECAR_CONFIG.port),
    capability: String(args.capability ?? DEFAULT_SIDECAR_CONFIG.capability),
    protocol: String(args.protocol ?? DEFAULT_SIDECAR_CONFIG.protocol),
    allowRemoteBind: Boolean(args['allow-remote-bind']),
    token: typeof args.token === 'string' ? args.token : null,
    noAuth: Boolean(args['no-auth']),
    printToken: Boolean(args['print-token']),
    allowedOrigins: Array.isArray(args['allow-origin'])
      ? (args['allow-origin'] as string[])
      : typeof args['allow-origin'] === 'string'
        ? [args['allow-origin']]
        : [],
  };

  try {
    validateBindHost(config.host, config.allowRemoteBind);
    validateNoAuthBind(config.host, config.noAuth);
  } catch (error) {
    console.error(String(error));
    return 2;
  }

  const handle = await runSidecar(config);
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void handle.stop().finally(() => resolve());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  return 0;
}

interface CliArgs {
  [key: string]: string | boolean | string[] | undefined;
}

function parseArgs(argv: string[]): { command: string; args: CliArgs } {
  if (!argv.length || !argv[0]) {
    throw new Error('command required');
  }
  const command = argv[0];
  const args: CliArgs = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else if (key === 'allow-origin') {
      const origins = Array.isArray(args[key]) ? (args[key] as string[]) : [];
      origins.push(next);
      args[key] = origins;
      index += 1;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return { command, args };
}

/** Runs the plenipo-agent CLI. */
export async function main(argv: string[]): Promise<number> {
  try {
    const { command, args } = parseArgs(argv);
    if (command === 'run') {
      return await runAgent(args);
    }
    if (command === 'status') {
      return await showStatus();
    }
    if (command === 'outbox') {
      return showOutbox();
    }
    if (command === 'receipts') {
      return showReceipts();
    }
    if (command === 'sidecar') {
      return await runSidecarCommand(args);
    }
    if (command === 'sidecar-token') {
      return showSidecarToken(args);
    }
    if (command === 'events') {
      return await showEvents(args);
    }
    if (command === 'inbox') {
      return showInbox();
    }
    console.error(`unknown command: ${command}`);
    return 2;
  } catch (error) {
    console.error(String(error));
    return 2;
  }
}
