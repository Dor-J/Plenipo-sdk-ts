import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createDidDocument } from '../../did/create.js';
import { discoverAgents } from '../../discover/index.js';
import { getDeliveryStatus } from '../../delivery/index.js';
import { mandatePrepare, purchaseBundle } from '../../payments/index.js';
import { declareCapabilities } from '../../identity/capabilities.js';
import { declareRoute, routeFromDocument } from '../../identity/route.js';
import { ensureIdentity } from '../../identity/provision.js';
import { syncIdentityWithCore, syncResultToDict } from '../../identity/sync.js';
import { getMcpRuntime } from '../runtime.js';

/**
 * Registers Plenipo MCP tools.
 */
export function registerPlenipoTools(server: McpServer): void {
  server.registerTool(
    'plenipo_send',
    {
      description:
        'Send an encrypted message to another agent by DID (offline recipients are queued with ack.status queued)',
      inputSchema: {
        recipientDid: z.string(),
        message: z.string(),
        recipientDocumentUrl: z.string().optional(),
        priority: z.enum(['low', 'normal', 'high']).default('normal'),
      },
    },
    async ({ recipientDid, message, recipientDocumentUrl }) => {
      const runtime = getMcpRuntime();
      const ack = await runtime.send(recipientDid, message, recipientDocumentUrl);
      return {
        content: [{ type: 'text', text: JSON.stringify(ack, null, 2) }],
      };
    },
  );

  server.registerTool(
    'plenipo_receive',
    {
      description: 'Poll or stream incoming messages from other agents',
      inputSchema: {
        since: z.string().optional(),
        limit: z.number().int().positive().max(100).default(100),
      },
    },
    async ({ since, limit }) => {
      const runtime = getMcpRuntime();
      await runtime.ensureConnected();
      const messages = runtime.drainMessages(since, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify({ messages }, null, 2) }],
      };
    },
  );

  server.registerTool(
    'plenipo_discover',
    {
      description: 'Search the DID registry for Route Records',
      inputSchema: {
        query: z.string().optional(),
        capability: z.string().optional(),
        protocol: z.string().optional(),
        paymentScheme: z.string().optional(),
        maxPricePerKbTokens: z.number().int().optional(),
        online: z.boolean().optional(),
        limit: z.number().int().positive().max(100).default(20),
      },
    },
    async ({ query, capability, protocol, paymentScheme, maxPricePerKbTokens, online, limit }) => {
      const results = await discoverAgents({
        query,
        capability,
        protocol,
        paymentScheme,
        maxPricePerKbTokens,
        online,
        limit,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  server.registerTool(
    'plenipo_balance',
    {
      description: 'Check current token balance',
      inputSchema: {},
    },
    async () => {
      const runtime = getMcpRuntime();
      const balance = await runtime.getBalance();
      return {
        content: [{ type: 'text', text: JSON.stringify({ balance }, null, 2) }],
      };
    },
  );

  server.registerTool(
    'plenipo_purchase_bundle',
    {
      description: 'Purchase a token bundle via x402 (HTTP 402 retry)',
      inputSchema: {
        agentDid: z.string(),
        bundleId: z.string(),
        relayUrl: z.string().default('http://localhost:4000'),
      },
    },
    async ({ agentDid, bundleId, relayUrl }) => {
      const receipt = await purchaseBundle(relayUrl, agentDid, bundleId);
      return {
        content: [{ type: 'text', text: JSON.stringify(receipt, null, 2) }],
      };
    },
  );

  server.registerTool(
    'plenipo_mandate_prepare',
    {
      description: 'Prepare unsigned mandate JSON for operator signing',
      inputSchema: {
        agentDid: z.string(),
        operatorDid: z.string(),
        relayUrl: z.string().default('http://localhost:4000'),
      },
    },
    async ({ agentDid, operatorDid, relayUrl }) => {
      const result = await mandatePrepare(relayUrl, {
        agent_did: agentDid,
        operator_did: operatorDid,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'plenipo_receipts',
    {
      description: 'List persisted delivery receipts with billing metadata',
      inputSchema: {
        since: z.string().optional(),
        limit: z.number().int().positive().max(500).default(100),
      },
    },
    async ({ since, limit }) => {
      const runtime = getMcpRuntime();
      const receipts = await runtime.listReceipts({ since, limit });
      return {
        content: [{ type: 'text', text: JSON.stringify({ receipts }, null, 2) }],
      };
    },
  );

  server.registerTool(
    'plenipo_delivery_status',
    {
      description: 'Get delivery status for an envelope (queued, delivered, receipt_confirmed, expired)',
      inputSchema: {
        envelopeId: z.string(),
        relayUrl: z.string().default('http://localhost:4000'),
      },
    },
    async ({ envelopeId, relayUrl }) => {
      const status = await getDeliveryStatus(relayUrl, envelopeId);
      return {
        content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
      };
    },
  );

  server.registerTool(
    'plenipo_identity',
    {
      description: 'Show the current local agent identity',
      inputSchema: {},
    },
    async () => {
      const identity = await ensureIdentity();
      const route = routeFromDocument(identity.document);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                did: identity.did,
                didDocumentUrl: identity.didDocumentUrl,
                didDocumentMode: identity.didDocumentMode,
                coreRegistered: identity.coreRegistered,
                registrationPending: identity.registrationPending,
                capabilities: identity.capabilities,
                relayUrl: identity.relayUrl,
                registryUrl: identity.registryUrl,
                coreUrl: identity.coreUrl,
                route: {
                  protocols: route.protocols,
                  capabilities: route.capabilities,
                  encryption: {
                    alg: route.encryption.alg,
                    public_key_ref: route.encryption.publicKeyRef,
                  },
                  payment: route.payment,
                  limits: route.limits,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'plenipo_sync_identity',
    {
      description: 'Register or retry Core sync for the local agent identity',
      inputSchema: {},
    },
    async () => {
      const identity = await ensureIdentity();
      if (identity.didDocumentMode !== 'core_hosted') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                syncResultToDict({
                  ok: true,
                  did: identity.did,
                  coreRegistered: identity.coreRegistered,
                  registrationPending: false,
                  documentFingerprint: identity.documentFingerprint,
                  warnings: ['External identity; Core sync not required'],
                }),
                null,
                2,
              ),
            },
          ],
        };
      }

      const [, result] = await syncIdentityWithCore(identity);
      return {
        content: [{ type: 'text', text: JSON.stringify(syncResultToDict(result), null, 2) }],
      };
    },
  );

  server.registerTool(
    'plenipo_declare_route',
    {
      description: 'Declare or update agent Route Record metadata in Core-hosted DID',
      inputSchema: {
        protocols: z.array(z.string()).optional(),
        capabilities: z.array(z.string()).optional(),
        payment: z
          .object({
            model: z.string().optional(),
            price_per_kb_tokens: z.number().int().optional(),
            accepted_schemes: z.array(z.string()).optional(),
          })
          .optional(),
        limits: z
          .object({
            max_message_kb: z.number().int().optional(),
            offline_queue_ttl_seconds: z.number().int().optional(),
          })
          .optional(),
        replace: z.boolean().default(false),
      },
    },
    async ({ protocols, capabilities, payment, limits, replace }) => {
      const updated = await declareRoute(
        { protocols, capabilities, payment, limits },
        { replace },
      );
      const route = routeFromDocument(updated.document);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                did: updated.did,
                route,
                coreRegistered: updated.coreRegistered,
                registrationPending: updated.registrationPending,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'plenipo_declare_capabilities',
    {
      description: 'Declare or update agent capabilities in Core-hosted DID',
      inputSchema: {
        capabilities: z.array(z.string()).min(1),
        replace: z.boolean().default(false),
      },
    },
    async ({ capabilities, replace }) => {
      const updated = await declareCapabilities(capabilities, { replace });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                did: updated.did,
                capabilities: updated.capabilities,
                coreRegistered: updated.coreRegistered,
                registrationPending: updated.registrationPending,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'plenipo_did_create',
    {
      description: 'Generate a new DID document and key pair',
      inputSchema: {
        domain: z.string(),
      },
    },
    async ({ domain }) => {
      const result = await createDidDocument(domain);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { did: result.did, document: result.document, privateKeys: result.privateKeys },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
