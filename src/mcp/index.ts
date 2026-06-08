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

export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

export async function bootstrapMcpRuntime(): Promise<void> {
  const { McpRuntime, loadMcpConfig, setMcpRuntime } = await import('./runtime.js');
  const config = await loadMcpConfig();
  setMcpRuntime(new McpRuntime(config));
}

export async function main(
  serverFactory = createPlenipoMcpServer,
  transportFactory = createStdioTransport,
): Promise<void> {
  await bootstrapMcpRuntime();
  const server = serverFactory();
  const transport = transportFactory();
  await server.connect(transport);
}

export function handleMainError(error: unknown): never {
  console.error(error);
  process.exit(1);
}

if (import.meta.main) {
  main().catch(handleMainError);
}
