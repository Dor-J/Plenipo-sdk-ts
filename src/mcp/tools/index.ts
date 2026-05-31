import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createDidDocument } from '../../did/create.js';
import { discoverAgents } from '../../discover/index.js';
import { getDeliveryStatus } from '../../delivery/index.js';
import { mandatePrepare, purchaseBundle } from '../../payments/index.js';
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
      description: 'Search the DID registry for agents',
      inputSchema: {
        query: z.string().optional(),
        capability: z.string().optional(),
      },
    },
    async ({ query, capability }) => {
      const results = await discoverAgents({ query, capability });
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
