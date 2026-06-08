import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlenipoClient } from '../client/index.js';
import { createDidDocument } from '../did/create.js';
import { identityFromCreateResult, saveIdentity } from '../identity/store.js';
import {
  McpRuntime,
  getMcpRuntime,
  loadMcpConfigFromEnv,
  resetMcpRuntime,
  type BufferedMessage,
} from './runtime.js';

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

  it('loadMcpConfigFromEnv reads required and optional env', () => {
    const previous = captureEnv();
    process.env.PLENIPO_DID = 'did:web:env.local';
    process.env.PLENIPO_AUTH_SECRET_B64 = 'AUTH';
    process.env.PLENIPO_DID_DOCUMENT_URL = 'https://env.local/.well-known/did.json';
    process.env.PLENIPO_RELAY_URL = 'wss://relay.local/agent/websocket';
    process.env.PLENIPO_REGISTRY_URL = 'https://registry.local';

    const config = loadMcpConfigFromEnv();

    expect(config.did).toBe('did:web:env.local');
    expect(config.registryUrl).toBe('https://registry.local');
    restoreEnv(previous);
  });

  it('loadMcpConfigFromEnv reads identity file when env is missing', () => {
    const previous = captureEnv();
    const previousHome = process.env.PLENIPO_HOME;
    const tempHome = mkdtempSync(join(tmpdir(), 'plenipo-runtime-'));
    process.env.PLENIPO_HOME = tempHome;
    delete process.env.PLENIPO_DID;
    delete process.env.PLENIPO_AUTH_SECRET_B64;
    delete process.env.PLENIPO_DID_PRIVATE_KEY;
    delete process.env.PLENIPO_DID_DOCUMENT_URL;

    saveIdentity(
      identityFromCreateResult({
        did: 'did:web:localhost:agents:runtime',
        authSecretB64: 'AUTH',
        encSecretB64: 'ENC',
        didDocumentUrl: 'https://localhost/agents/runtime/did.json',
        document: { id: 'did:web:localhost:agents:runtime', service: [] },
        relayUrl: 'ws://localhost:4000/agent/websocket',
        registryUrl: 'http://localhost:4001',
        coreUrl: 'http://localhost:4000',
      }),
    );

    const config = loadMcpConfigFromEnv();
    expect(config.did).toBe('did:web:localhost:agents:runtime');
    rmSync(tempHome, { recursive: true, force: true });
    if (previousHome === undefined) {
      delete process.env.PLENIPO_HOME;
    } else {
      process.env.PLENIPO_HOME = previousHome;
    }
    restoreEnv(previous);
  });

  it('loadMcpConfigFromEnv rejects missing identity', () => {
    const previous = captureEnv();
    const previousHome = process.env.PLENIPO_HOME;
    const tempHome = mkdtempSync(join(tmpdir(), 'plenipo-runtime-missing-'));
    process.env.PLENIPO_HOME = tempHome;
    delete process.env.PLENIPO_DID;
    delete process.env.PLENIPO_AUTH_SECRET_B64;
    delete process.env.PLENIPO_DID_PRIVATE_KEY;
    delete process.env.PLENIPO_DID_DOCUMENT_URL;

    expect(() => loadMcpConfigFromEnv()).toThrow(/Missing MCP identity/);
    rmSync(tempHome, { recursive: true, force: true });
    if (previousHome === undefined) {
      delete process.env.PLENIPO_HOME;
    } else {
      process.env.PLENIPO_HOME = previousHome;
    }
    restoreEnv(previous);
  });

  it('uses an injected client for balance and buffered handlers', async () => {
    const runtime = new McpRuntime({
      did: 'did:web:test.local',
      authSecretB64: 'AAAA',
      didDocumentUrl: 'https://test.local/.well-known/did.json',
      relayUrl: 'ws://localhost:4000/agent/websocket',
    });
    const privateRuntime = runtime as unknown as {
      client: {
        relayHttpUrl: string;
        connect: () => Promise<void>;
        getBalance: () => Promise<number>;
        onMessage: (handler: (payload: Record<string, string>) => void) => void;
        onReceipt: (handler: (payload: { envelope_id: string; received_at?: string }) => void) => void;
      };
    };

    privateRuntime.client = {
      relayHttpUrl: 'http://relay.local',
      connect: async () => undefined,
      getBalance: async () => 88,
      onMessage: () => undefined,
      onReceipt: () => undefined,
    };

    expect(await runtime.getBalance()).toBe(88);
  });

  it('ensureConnected registers buffering handlers on the relay client', async () => {
    const previousConnect = PlenipoClient.prototype.connect;
    PlenipoClient.prototype.connect = async () => undefined;

    try {
      const runtime = new McpRuntime({
        did: 'did:web:test.local',
        authSecretB64: Buffer.alloc(32).toString('base64url'),
        didDocumentUrl: 'https://test.local/.well-known/did.json',
        relayUrl: 'ws://localhost:4000/agent/websocket',
        encSecretB64: Buffer.alloc(32).toString('base64url'),
      });

      const client = (await runtime.ensureConnected()) as unknown as {
        handlers: Array<(payload: Record<string, string>) => void>;
        receiptHandlers: Array<(payload: { envelope_id: string; received_at?: string }) => void>;
      };

      client.handlers[0]?.({
        envelope_id: '01JMSG',
        sender_did: 'did:web:sender.local',
        recipient_did: 'did:web:test.local',
        ciphertext: 'not-valid-sealed-box',
      });
      client.receiptHandlers[0]?.({ envelope_id: '01JMSG', received_at: 'now' });

      const drained = runtime.drainMessages(undefined, 10);
      expect(drained.map((entry) => entry.kind)).toEqual(['deliver', 'receipt']);
    } finally {
      PlenipoClient.prototype.connect = previousConnect;
    }
  });

  it('send resolves the recipient key and delegates to the relay client', async () => {
    const previousConnect = PlenipoClient.prototype.connect;
    const previousSend = PlenipoClient.prototype.send;
    const previousFetch = globalThis.fetch;
    const previousUnsafe = process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH;
    const recipient = await createDidDocument('recipient.local');

    PlenipoClient.prototype.connect = async () => undefined;
    PlenipoClient.prototype.send = async (recipientDid, message, key) => ({
      type: 'ack',
      v: '1.0',
      envelope_id: '01JACK',
      status: key.length === 32 && message === 'hello' && recipientDid === recipient.did
        ? 'queued'
        : 'delivered',
    });
    process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = 'true';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(recipient.document), { status: 200 })) as unknown as typeof fetch;

    try {
      const runtime = new McpRuntime({
        did: 'did:web:test.local',
        authSecretB64: Buffer.alloc(32).toString('base64url'),
        didDocumentUrl: 'https://test.local/.well-known/did.json',
        relayUrl: 'ws://localhost:4000/agent/websocket',
      });

      const ack = await runtime.send(recipient.did, 'hello', 'https://recipient.local/.well-known/did.json');
      expect(ack.status).toBe('queued');
    } finally {
      PlenipoClient.prototype.connect = previousConnect;
      PlenipoClient.prototype.send = previousSend;
      globalThis.fetch = previousFetch;
      if (previousUnsafe === undefined) {
        delete process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH;
      } else {
        process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = previousUnsafe;
      }
    }
  });

  it('getMcpRuntime returns a resettable singleton', () => {
    const previous = captureEnv();
    resetMcpRuntime();
    process.env.PLENIPO_DID = 'did:web:singleton.local';
    process.env.PLENIPO_AUTH_SECRET_B64 = 'AUTH';
    process.env.PLENIPO_DID_DOCUMENT_URL = 'https://singleton.local/.well-known/did.json';

    const first = getMcpRuntime();
    expect(getMcpRuntime()).toBe(first);
    resetMcpRuntime();
    expect(getMcpRuntime()).not.toBe(first);
    restoreEnv(previous);
    resetMcpRuntime();
  });
});

function captureEnv(): Record<string, string | undefined> {
  return {
    PLENIPO_DID: process.env.PLENIPO_DID,
    PLENIPO_AUTH_SECRET_B64: process.env.PLENIPO_AUTH_SECRET_B64,
    PLENIPO_DID_PRIVATE_KEY: process.env.PLENIPO_DID_PRIVATE_KEY,
    PLENIPO_DID_DOCUMENT_URL: process.env.PLENIPO_DID_DOCUMENT_URL,
    PLENIPO_RELAY_URL: process.env.PLENIPO_RELAY_URL,
    PLENIPO_REGISTRY_URL: process.env.PLENIPO_REGISTRY_URL,
  };
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
