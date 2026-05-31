#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPlenipoTools } from './tools/index.js';

/**
 * Creates the Plenipo MCP server with stdio transport (scaffold).
 */
export function createPlenipoMcpServer(): McpServer {
  const server = new McpServer({
    name: 'plenipo',
    version: '0.0.1',
  });

  registerPlenipoTools(server);

  return server;
}

async function main(): Promise<void> {
  const server = createPlenipoMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
