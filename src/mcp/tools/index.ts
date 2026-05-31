import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Registers Plenipo MCP tools (scaffold — handlers return placeholders).
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
      content: [{ type: 'text', text: 'Not implemented yet.' }],
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
      content: [{ type: 'text', text: 'Not implemented yet.' }],
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
    async () => ({
      content: [{ type: 'text', text: 'Not implemented yet.' }],
    }),
  );

  server.registerTool(
    'plenipo_balance',
    {
      description: 'Check current token balance',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: 'Not implemented yet.' }],
    }),
  );

  server.registerTool(
    'plenipo_did_create',
    {
      description: 'Generate a new DID document and key pair',
      inputSchema: {
        domain: z.string().optional(),
      },
    },
    async () => ({
      content: [{ type: 'text', text: 'Not implemented yet.' }],
    }),
  );
}
