#!/usr/bin/env bun
/** E2E: Sidecar v0.3 durable local events survive sidecar restart (TypeScript). */

import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { Database } from 'bun:sqlite';

const TOKEN_A = 'e2e-durable-token-a';
const TOKEN_B = 'e2e-durable-token-b';
const PORT_A = 19887;
const PORT_B = 19888;

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

async function waitHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
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

async function pollMessage(baseUrl: string, token: string, plaintext: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let afterId = 0;
  while (Date.now() < deadline) {
    const params = new URLSearchParams({
      timeout_ms: '2000',
      limit: '20',
      after_id: String(afterId),
    });
    const response = await fetch(`${baseUrl}/events?${params.toString()}`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`events failed: ${response.status}`);
    }
    const body = (await response.json()) as {
      events?: Array<Record<string, unknown>>;
      next_after_id?: number;
    };
    afterId = Number(body.next_after_id ?? afterId);
    for (const event of body.events ?? []) {
      if (event.type === 'message' && event.plaintext === plaintext) {
        return;
      }
    }
  }
  throw new Error('Timed out waiting for durable message event');
}

function spawnSidecar(port: number, home: string, token: string): ChildProcess {
  const sdkRoot = join(import.meta.dir, '..');
  return spawn(
    process.execPath,
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
      stdio: 'ignore',
    },
  );
}

async function main(): Promise<number> {
  if (process.platform === 'win32') {
    process.env.PLENIPO_CORE_URL ??= 'http://127.0.0.1:4000';
    process.env.PLENIPO_REGISTRY_URL ??= 'http://127.0.0.1:4001';
    process.env.PLENIPO_RELAY_URL ??= 'ws://127.0.0.1:4000/agent/websocket';
  }

  const coreUrl = process.env.PLENIPO_CORE_URL ?? 'http://localhost:4000';
  try {
    await fetch(`${coreUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    fail(`Core unreachable at ${coreUrl}`);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'plenipo-durable-ts-e2e-'));
  const homeA = join(tmp, 'agent-a');
  const homeB = join(tmp, 'agent-b');

  const baseA = `http://127.0.0.1:${PORT_A}`;
  const baseB = `http://127.0.0.1:${PORT_B}`;
  const payloadText = JSON.stringify({ kind: 'plenipo.sidecar.v0.3', nonce: 'durable-ts' });

  let procA = spawnSidecar(PORT_A, homeA, TOKEN_A);
  let procB = spawnSidecar(PORT_B, homeB, TOKEN_B);

  const stop = async (): Promise<void> => {
    for (const proc of [procA, procB]) {
      proc.kill('SIGTERM');
    }
    await Bun.sleep(1000);
  };

  try {
    await waitHealth(baseA);
    await waitHealth(baseB);
    ok('Both sidecars healthy');

    const statusB = (await (
      await fetch(`${baseB}/status`, { headers: authHeaders(TOKEN_B) })
    ).json()) as { did: string };
    const didB = statusB.did;

    const sendResponse = await fetch(`${baseA}/send`, {
      method: 'POST',
      headers: { ...authHeaders(TOKEN_A), 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_did: didB, message: payloadText }),
    });
    if (!sendResponse.ok) {
      fail(`Send failed: ${sendResponse.status}`);
    }
    const envelopeId = String(((await sendResponse.json()) as { envelope_id: string }).envelope_id);
    ok(`Agent A sent message (${envelopeId})`);

    await pollMessage(baseB, TOKEN_B, payloadText);
    ok('Agent B received live message');

    const dbPath = join(homeB, 'runtime.sqlite');
    const db = new Database(dbPath, { readonly: true });
    const inboxCount = (
      db.query('SELECT COUNT(*) AS count FROM inbox_messages').get() as { count: number }
    ).count;
    const eventCount = (
      db.query('SELECT COUNT(*) AS count FROM sidecar_events').get() as { count: number }
    ).count;
    db.close();
    const dbBytes = readFileSync(dbPath);
    if (inboxCount < 1 || eventCount < 1) {
      fail('Expected durable inbox and sidecar_events rows');
    }
    if (dbBytes.includes(Buffer.from(payloadText))) {
      fail('Raw plaintext found unencrypted in runtime.sqlite');
    }
    ok('Encrypted inbox and durable events persisted');

    procB.kill('SIGTERM');
    await Bun.sleep(1000);
    procB = spawnSidecar(PORT_B, homeB, TOKEN_B);
    await waitHealth(baseB);
    ok('Agent B sidecar restarted with same PLENIPO_HOME');

    const restartResponse = await fetch(
      `${baseB}/events?after_id=0&timeout_ms=1000&limit=20&include_plaintext=true`,
      { headers: authHeaders(TOKEN_B), signal: AbortSignal.timeout(10_000) },
    );
    if (!restartResponse.ok) {
      fail(`Events after restart failed: ${restartResponse.status}`);
    }
    const restartBody = (await restartResponse.json()) as { events?: Array<Record<string, unknown>> };
    const message = restartBody.events?.find(
      (event) => event.type === 'message' && event.plaintext === payloadText,
    );
    if (!message) {
      fail('Durable message not available after restart');
    }
    ok('Durable message with plaintext returned after restart');

    const metaResponse = await fetch(`${baseB}/events?after_id=0&limit=20&include_plaintext=false`, {
      headers: authHeaders(TOKEN_B),
    });
    const metaBody = (await metaResponse.json()) as { events?: Array<Record<string, unknown>> };
    const metaMessage = metaBody.events?.find((event) => event.type === 'message');
    if (!metaMessage?.has_plaintext || metaMessage.plaintext !== undefined) {
      fail('Expected metadata-only message event with has_plaintext=true');
    }
    ok('include_plaintext=false returns metadata only');

    const receiptResponse = await fetch(`${baseA}/events?after_id=0&timeout_ms=2000&limit=20`, {
      headers: authHeaders(TOKEN_A),
    });
    const receiptBody = (await receiptResponse.json()) as { events?: Array<Record<string, unknown>> };
    const receipt = receiptBody.events?.find(
      (event) => event.type === 'delivery_receipt' && event.envelope_id === envelopeId,
    );
    if (!receipt) {
      fail('Expected durable delivery receipt for sender');
    }
    ok('Delivery receipt durable for sender');

    console.log('\nAll TypeScript durable sidecar E2E steps passed.');
    return 0;
  } finally {
    await stop();
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
