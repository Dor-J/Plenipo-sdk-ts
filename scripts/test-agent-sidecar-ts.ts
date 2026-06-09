#!/usr/bin/env bun
/** E2E: Plenipo Agent Sidecar v0.2.1 authenticated two-agent messaging (TypeScript). */

import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

const DEFAULT_ROUTE = {
  protocols: ['plenipo.message.v1'],
  capabilities: ['general', 'mcp'],
  payment: {
    model: 'per_kb',
    price_per_kb_tokens: 1,
    accepted_schemes: ['plenipo-dev-token'],
  },
  limits: {
    max_message_kb: 256,
    offline_queue_ttl_seconds: 86400,
  },
};

const TOKEN_A = 'e2e-sidecar-token-a';
const TOKEN_B = 'e2e-sidecar-token-b';

function ok(message: string): void {
  console.log(`[OK] ${message}`);
}

function fail(message: string): never {
  console.log(`[FAIL] ${message}`);
  process.exit(1);
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function assertNoSecrets(payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const secret of ['auth_secret', 'enc_secret', 'private_key', 'privateKey']) {
    if (text.includes(secret)) {
      throw new Error(`Secret marker ${secret} found in API output`);
    }
  }
  for (const token of [TOKEN_A, TOKEN_B]) {
    if (text.includes(token)) {
      throw new Error('Bearer token found in API output');
    }
  }
  if (payload && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (['auth_secret_b64', 'enc_secret_b64', 'ciphertext'].includes(key)) {
        throw new Error(`Secret field ${key} found in API output`);
      }
      assertNoSecrets(value);
    }
  } else if (Array.isArray(payload)) {
    for (const item of payload) {
      assertNoSecrets(item);
    }
  }
}

async function waitHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) {
        const body = (await response.json()) as { ok?: boolean };
        if (body.ok) {
          return;
        }
      }
    } catch {
      // retry
    }
    await Bun.sleep(500);
  }
  throw new Error(`Sidecar health check timed out for ${baseUrl}`);
}

async function pollEvents(
  baseUrl: string,
  token: string,
  afterId: number,
  predicate: (event: Record<string, unknown>) => boolean,
  timeoutMs = 30_000,
): Promise<{ event: Record<string, unknown>; cursor: number }> {
  const deadline = Date.now() + timeoutMs;
  let cursor = afterId;
  while (Date.now() < deadline) {
    const params = new URLSearchParams({
      timeout_ms: '2000',
      limit: '20',
      after_id: String(cursor),
    });
    const response = await fetch(`${baseUrl}/events?${params.toString()}`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`events failed: ${response.status}`);
    }
    const body = (await response.json()) as {
      events?: Record<string, unknown>[];
      next_after_id?: number;
      since_id?: number;
    };
    assertNoSecrets(body);
    cursor = Number(body.next_after_id ?? body.since_id ?? cursor);
    for (const event of body.events ?? []) {
      if (predicate(event)) {
        return { event, cursor };
      }
    }
  }
  throw new Error('Timed out waiting for sidecar event');
}

function applyLocalDefaults(): void {
  if (process.platform === 'win32') {
    process.env.PLENIPO_CORE_URL ??= 'http://127.0.0.1:4000';
    process.env.PLENIPO_REGISTRY_URL ??= 'http://127.0.0.1:4001';
    process.env.PLENIPO_RELAY_URL ??= 'ws://127.0.0.1:4000/agent/websocket';
  }
}

async function main(): Promise<number> {
  applyLocalDefaults();
  const coreUrl = process.env.PLENIPO_CORE_URL ?? 'http://localhost:4000';
  try {
    await fetch(`${coreUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    fail(`Core unreachable at ${coreUrl}`);
  }

  const sdkRoot = join(import.meta.dir, '..');
  const bun = process.execPath;
  const tmp = mkdtempSync(join(tmpdir(), 'plenipo-sidecar-ts-e2e-'));
  const homeA = join(tmp, 'agent-a');
  const homeB = join(tmp, 'agent-b');

  const spawnSidecar = (port: number, home: string, token: string): ChildProcess =>
    spawn(
      bun,
      [join(sdkRoot, 'src/agent/index.ts'), 'sidecar', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: join(sdkRoot, '..'),
        env: {
          ...process.env,
          PLENIPO_HOME: home,
          PLENIPO_SIDECAR_TOKEN: token,
          PLENIPO_CORE_URL: process.env.PLENIPO_CORE_URL ?? 'http://127.0.0.1:4000',
          PLENIPO_REGISTRY_URL: process.env.PLENIPO_REGISTRY_URL ?? 'http://127.0.0.1:4001',
          PLENIPO_RELAY_URL: process.env.PLENIPO_RELAY_URL ?? 'ws://127.0.0.1:4000/agent/websocket',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

  const portA = 18787;
  const portB = 18788;
  const baseA = `http://127.0.0.1:${portA}`;
  const baseB = `http://127.0.0.1:${portB}`;

  const procA = spawnSidecar(portA, homeA, TOKEN_A);
  const procB = spawnSidecar(portB, homeB, TOKEN_B);

  const stop = async (): Promise<void> => {
    for (const proc of [procA, procB]) {
      proc.kill('SIGTERM');
    }
    await Bun.sleep(1000);
    for (const proc of [procA, procB]) {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }
  };

  try {
    await waitHealth(baseA);
    await waitHealth(baseB);
    ok('Both sidecars healthy');

    const unauth = await fetch(`${baseA}/status`);
    if (unauth.status !== 401) {
      fail(`Expected unauthenticated /status 401, got ${unauth.status}`);
    }
    ok('Unauthenticated /status returns 401');

    const statusA = (await (
      await fetch(`${baseA}/status`, { headers: authHeaders(TOKEN_A) })
    ).json()) as Record<string, unknown>;
    const statusB = (await (
      await fetch(`${baseB}/status`, { headers: authHeaders(TOKEN_B) })
    ).json()) as Record<string, unknown>;
    assertNoSecrets(statusA);
    assertNoSecrets(statusB);
    const didA = String(statusA.did);
    const didB = String(statusB.did);
    ok(`Authenticated /status loaded (A=${didA}, B=${didB})`);

    for (const [base, token] of [
      [baseA, TOKEN_A],
      [baseB, TOKEN_B],
    ] as const) {
      const response = await fetch(`${base}/route`, {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_ROUTE),
      });
      if (!response.ok) {
        fail(`Route declare failed: ${response.status}`);
      }
      assertNoSecrets(await response.json());
    }
    ok('Both agents declared Route Records');

    await Bun.sleep(3000);

    const discover = await fetch(
      `${baseA}/discover?capability=mcp&protocol=plenipo.message.v1&limit=20`,
      { headers: authHeaders(TOKEN_A) },
    );
    const discoverBody = (await discover.json()) as { results?: Array<{ did?: string }> };
    assertNoSecrets(discoverBody.results);
    if (!discoverBody.results?.some((item) => item.did === didB)) {
      fail('Agent A did not discover Agent B via /discover');
    }
    ok('Agent A discovered Agent B');

    const payloadText = JSON.stringify({ kind: 'plenipo.sidecar', nonce: 'v0.2.1-ts' });
    const sendResponse = await fetch(`${baseA}/send`, {
      method: 'POST',
      headers: { ...authHeaders(TOKEN_A), 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_did: didB, message: payloadText }),
    });
    if (!sendResponse.ok) {
      fail(`Send failed: ${sendResponse.status}`);
    }
    const sendBody = (await sendResponse.json()) as Record<string, unknown>;
    assertNoSecrets(sendBody);
    const envelopeId = String(sendBody.envelope_id);
    if (sendBody.charged_tokens == null || sendBody.ciphertext_bytes == null) {
      fail('Send response missing billing metadata');
    }
    ok(`Agent A sent message (${envelopeId})`);

    await pollEvents(
      baseB,
      TOKEN_B,
      0,
      (event) => event.type === 'message' && event.plaintext === payloadText,
    );
    ok('Agent B received plaintext via authenticated /events');

    await pollEvents(
      baseA,
      TOKEN_A,
      0,
      (event) => event.type === 'delivery_receipt' && event.envelope_id === envelopeId,
    );
    ok('Agent A received delivery receipt via authenticated /events');

    const outbox = (
      (await (await fetch(`${baseA}/outbox`, { headers: authHeaders(TOKEN_A) })).json()) as {
        outbox?: Array<Record<string, unknown>>;
      }
    ).outbox;
    assertNoSecrets(outbox);
    const row = outbox?.find((item) => item.envelope_id === envelopeId);
    if (!row || row.status !== 'delivered') {
      fail(`Expected outbox delivered for ${envelopeId}, got ${row?.status ?? 'missing'}`);
    }

    const receipts = (
      (await (await fetch(`${baseA}/receipts`, { headers: authHeaders(TOKEN_A) })).json()) as {
        receipts?: Array<Record<string, unknown>>;
      }
    ).receipts;
    assertNoSecrets(receipts);
    const receiptRow = receipts?.find((item) => item.envelope_id === envelopeId);
    if (!receiptRow || receiptRow.charged_tokens == null) {
      fail('Expected local receipt row with billing metadata');
    }

    ok('Outbox delivered and receipts contain billing metadata');
    console.log('\nAll TypeScript sidecar E2E steps passed.');
    return 0;
  } finally {
    await stop();
    // Temp dir cleanup is best-effort; Windows may lock SQLite files briefly.
  }
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
