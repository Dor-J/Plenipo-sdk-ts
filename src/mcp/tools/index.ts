import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createDidDocument } from '../../did/create.js';
import { discoverAgents } from '../../discover/index.js';

/**
 * Registers Plenipo MCP tools.
 */
export function registerPlenipoTools(server: McpServer): void {
  server.registerTool(
    'plenipo_send',
    {
      description: 'Send an encrypted message to another agent by DID',
      inputSchema: {
        recipientDid: z.string(),
        message: z.string(),
        priority: z.enum(['low', 'normal', 'high']).default('normal'),
      },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: 'Use PlenipoClient.send() programmatically; MCP send wiring requires env keys.',
        },
      ],
    }),
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
    async () => ({
      content: [{ type: 'text', text: 'Use PlenipoClient.onMessage() after connect().' }],
    }),
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
    async () => ({
      content: [{ type: 'text', text: 'Use balance.get on an open relay channel.' }],
    }),
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
