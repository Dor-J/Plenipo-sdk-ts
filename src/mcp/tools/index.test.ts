import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlenipoClient } from '../../client/index.js';
import { createDidDocument } from '../../did/create.js';
import { identityFromCreateResult, saveIdentity } from '../../identity/store.js';
import { createPlenipoMcpServer } from '../index.js';
import { resetMcpRuntime, setMcpRuntime } from '../runtime.js';
import { registerPlenipoTools } from './index.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

describe('createPlenipoMcpServer', () => {
  afterEach(() => {
    resetMcpRuntime();
  });

  it('creates a server instance', () => {
    const server = createPlenipoMcpServer();
    expect(server).toBeDefined();
  });

  it('registers expected tool handlers', async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) {
        handlers.set(name, handler);
      },
    };

    registerPlenipoTools(fakeServer as never);

    expect([...handlers.keys()]).toEqual([
      'plenipo_send',
      'plenipo_receive',
      'plenipo_discover',
      'plenipo_balance',
      'plenipo_purchase_bundle',
      'plenipo_mandate_prepare',
      'plenipo_receipts',
      'plenipo_delivery_status',
      'plenipo_identity',
      'plenipo_sync_identity',
      'plenipo_declare_route',
      'plenipo_declare_capabilities',
      'plenipo_did_create',
    ]);

    const didCreate = await handlers.get('plenipo_did_create')?.({ domain: 'agent.local' });
    expect(JSON.stringify(didCreate)).toContain('did:web:agent.local');
  });

  it('executes HTTP-backed and runtime-backed tool handlers', async () => {
    const previousFetch = globalThis.fetch;
    const previousConnect = PlenipoClient.prototype.connect;
    const previousSend = PlenipoClient.prototype.send;
    const previousBalance = PlenipoClient.prototype.getBalance;
    const previousEnv = captureEnv();
    const recipient = await createDidDocument('recipient.local');
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) {
        handlers.set(name, handler);
      },
    };

    process.env.PLENIPO_DID = 'did:web:tool.local';
    process.env.PLENIPO_AUTH_SECRET_B64 = Buffer.alloc(32).toString('base64url');
    process.env.PLENIPO_DID_DOCUMENT_URL = 'https://tool.local/.well-known/did.json';
    process.env.PLENIPO_ALLOW_UNSAFE_DID_FETCH = 'true';
    PlenipoClient.prototype.connect = async () => undefined;
    PlenipoClient.prototype.getBalance = async () => 77;
    PlenipoClient.prototype.send = async () => ({
      type: 'ack',
      v: '1.0',
      envelope_id: '01JTOOL',
      status: 'queued',
    });
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes('/api/v1/search')) {
        return new Response(
          JSON.stringify({
            results: [{ did: recipient.did, document_url: 'https://recipient.local/.well-known/did.json' }],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/.well-known/did.json')) {
        return new Response(JSON.stringify(recipient.document), { status: 200 });
      }
      if (url.includes('/v1/bundles/purchase')) {
        return new Response(JSON.stringify({ tokens: 1000, balance: 1000 }), { status: 200 });
      }
      if (url.includes('/operator/prepare')) {
        return new Response(
          JSON.stringify({ mandate: { agent_did: 'did:web:tool.local' }, signing_input_base64: 'SIG' }),
          { status: 200 },
        );
      }
      if (url.includes('/v1/delivery/')) {
        return new Response(
          JSON.stringify({ type: 'delivery_status', v: '1.0', envelope_id: '01J', status: 'delivered' }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      registerPlenipoTools(fakeServer as never);

      await expect(
        handlers.get('plenipo_send')?.({
          recipientDid: recipient.did,
          recipientDocumentUrl: 'https://recipient.local/.well-known/did.json',
          message: 'hello',
        }),
      ).resolves.toBeDefined();
      await expect(handlers.get('plenipo_receive')?.({ limit: 10 })).resolves.toBeDefined();
      await expect(handlers.get('plenipo_balance')?.({})).resolves.toBeDefined();
      await expect(handlers.get('plenipo_discover')?.({ query: 'recipient' })).resolves.toBeDefined();
      await expect(
        handlers.get('plenipo_purchase_bundle')?.({
          agentDid: 'did:web:tool.local',
          bundleId: 'starter',
          relayUrl: 'https://relay.local',
        }),
      ).resolves.toBeDefined();
      await expect(
        handlers.get('plenipo_mandate_prepare')?.({
          agentDid: 'did:web:tool.local',
          operatorDid: 'did:web:operator.local',
          relayUrl: 'https://relay.local',
        }),
      ).resolves.toBeDefined();
      await expect(
        handlers.get('plenipo_delivery_status')?.({
          envelopeId: '01J',
          relayUrl: 'https://relay.local',
        }),
      ).resolves.toBeDefined();
    } finally {
      globalThis.fetch = previousFetch;
      PlenipoClient.prototype.connect = previousConnect;
      PlenipoClient.prototype.send = previousSend;
      PlenipoClient.prototype.getBalance = previousBalance;
      restoreEnv(previousEnv);
    }
  });

  it('executes receipt and external identity tool handlers from persisted local state', async () => {
    const previousEnv = captureEnv();
    const tempHome = mkdtempSync(join(tmpdir(), 'plenipo-mcp-tools-'));
    const handlers = registerHandlers();

    try {
      process.env.PLENIPO_HOME = tempHome;
      clearIdentityEnv();

      const created = await createDidDocument('identity.local');
      saveIdentity(
        identityFromCreateResult({
          did: created.did,
          authSecretB64: created.privateKeys.authSecretKey,
          encSecretB64: created.privateKeys.encSecretKey,
          didDocumentUrl: created.documentUrl,
          document: created.document,
          relayUrl: 'ws://localhost:4000/agent/websocket',
          registryUrl: 'http://localhost:4001',
          coreUrl: 'http://localhost:4000',
          didDocumentMode: 'external',
          coreRegistered: true,
          registrationPending: false,
        }),
      );

      setMcpRuntime({
        listReceipts: async (options?: { since?: string; limit?: number }) => [
          {
            envelope_id: '01JRECEIPT',
            charged_tokens: 3,
            since: options?.since,
            limit: options?.limit,
          },
        ],
      } as never);

      const identityPayload = toolPayload(await handlers.get('plenipo_identity')!({}));
      expect(identityPayload.did).toBe(created.did);
      expect(identityPayload.didDocumentMode).toBe('external');

      const receiptPayload = toolPayload(
        await handlers.get('plenipo_receipts')!({
          since: '2026-06-08T20:56:00Z',
          limit: 2,
        }),
      );
      const receipts = receiptPayload.receipts as Array<Record<string, unknown>>;
      expect(receipts[0]?.envelope_id).toBe('01JRECEIPT');
      expect(receipts[0]?.limit).toBe(2);

      const syncPayload = toolPayload(await handlers.get('plenipo_sync_identity')!({}));
      expect(syncPayload.ok).toBe(true);
      expect(syncPayload.registration_pending).toBe(false);
      expect(syncPayload.warnings).toEqual(['External identity; Core sync not required']);
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
      restoreEnv(previousEnv);
    }
  });

  it('declares route and capabilities through Core-hosted identity sync', async () => {
    const previousFetch = globalThis.fetch;
    const previousEnv = captureEnv();
    const tempHome = mkdtempSync(join(tmpdir(), 'plenipo-mcp-core-tools-'));
    const handlers = registerHandlers();

    try {
      process.env.PLENIPO_HOME = tempHome;
      clearIdentityEnv();

      const created = await createDidDocument('localhost', {
        pathSegments: ['agents', 'tool-agent'],
      });
      saveIdentity(
        identityFromCreateResult({
          did: created.did,
          authSecretB64: created.privateKeys.authSecretKey,
          encSecretB64: created.privateKeys.encSecretKey,
          didDocumentUrl: 'http://localhost:4000/v1/dids?did=did%3Aweb%3Alocalhost%3Aagents%3Atool-agent',
          document: created.document,
          relayUrl: 'ws://localhost:4000/agent/websocket',
          registryUrl: 'http://localhost:4001',
          coreUrl: 'http://localhost:4000',
          didDocumentMode: 'core_hosted',
          coreRegistered: true,
          registrationPending: false,
        }),
      );

      globalThis.fetch = (async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = String(input);
        if (url.endsWith('/auth/challenge')) {
          return new Response(JSON.stringify({ nonce: Buffer.from('nonce').toString('base64url') }), {
            status: 200,
          });
        }
        if (url.endsWith('/v1/dids')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            document?: Record<string, unknown>;
          };
          return new Response(
            JSON.stringify({
              did: body.document?.id,
              document_fingerprint: 'fingerprint-from-core',
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: 'unexpected url' }), { status: 404 });
      }) as typeof fetch;

      const routePayload = toolPayload(
        await handlers.get('plenipo_declare_route')!({
          protocols: ['plenipo.message.v1'],
          capabilities: ['search'],
          payment: {
            price_per_kb_tokens: 5,
            accepted_schemes: ['plenipo-prepaid-token'],
          },
          limits: {
            max_message_kb: 128,
            offline_queue_ttl_seconds: 3600,
          },
          replace: true,
        }),
      );
      const route = routePayload.route as { capabilities: string[]; payment: { price_per_kb_tokens: number } };
      expect(routePayload.did).toBe(created.did);
      expect(route.capabilities).toContain('search');
      expect(route.payment.price_per_kb_tokens).toBe(5);

      const capabilityPayload = toolPayload(
        await handlers.get('plenipo_declare_capabilities')!({
          capabilities: ['analytics'],
          replace: false,
        }),
      );
      const capabilities = capabilityPayload.capabilities as string[];
      expect(capabilities).toContain('search');
      expect(capabilities).toContain('analytics');
      expect(capabilityPayload.coreRegistered).toBe(true);

      const syncPayload = toolPayload(await handlers.get('plenipo_sync_identity')!({}));
      expect(syncPayload.ok).toBe(true);
      expect(syncPayload.core_registered).toBe(true);
      expect(syncPayload.did).toBe(created.did);
    } finally {
      globalThis.fetch = previousFetch;
      rmSync(tempHome, { recursive: true, force: true });
      restoreEnv(previousEnv);
    }
  });
});

function registerHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const fakeServer = {
    registerTool(
      name: string,
      _config: unknown,
      handler: ToolHandler,
    ) {
      handlers.set(name, handler);
    },
  };

  registerPlenipoTools(fakeServer as never);
  return handlers;
}

function toolPayload(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>;
}

const ENV_KEYS = [
  'PLENIPO_DID',
  'PLENIPO_AUTH_SECRET_B64',
  'PLENIPO_DID_PRIVATE_KEY',
  'PLENIPO_DID_DOCUMENT_URL',
  'PLENIPO_ENC_SECRET_B64',
  'PLENIPO_HOME',
  'PLENIPO_CORE_URL',
  'PLENIPO_RELAY_URL',
  'PLENIPO_REGISTRY_URL',
  'PLENIPO_ALLOW_UNSAFE_DID_FETCH',
] as const;

function captureEnv(): Record<string, string | undefined> {
  const captured: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    captured[key] = process.env[key];
  }
  return captured;
}

function clearIdentityEnv(): void {
  for (const key of [
    'PLENIPO_DID',
    'PLENIPO_AUTH_SECRET_B64',
    'PLENIPO_DID_PRIVATE_KEY',
    'PLENIPO_DID_DOCUMENT_URL',
    'PLENIPO_ENC_SECRET_B64',
  ]) {
    delete process.env[key];
  }
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
