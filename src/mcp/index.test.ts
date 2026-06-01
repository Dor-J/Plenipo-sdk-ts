import { describe, expect, it } from 'bun:test';
import { createStdioTransport, handleMainError, main } from './index.js';

describe('mcp main', () => {
  it('connects a created server to a transport', async () => {
    const calls: string[] = [];
    const server = {
      connect: async (transport: unknown) => {
        if (transport === 'transport') calls.push('connect');
      },
    };

    await main(() => server as never, () => 'transport' as never);

    expect(calls).toEqual(['connect']);
  });

  it('creates stdio transport and handles startup errors', () => {
    expect(createStdioTransport()).toBeDefined();
    const originalExit = process.exit;
    const originalError = console.error;
    const errors: unknown[] = [];
    console.error = (error?: unknown) => {
      errors.push(error);
    };
    process.exit = ((code?: string | number | null) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit;

    try {
      expect(() => handleMainError(new Error('boom'))).toThrow('exit 1');
      expect(String(errors[0])).toContain('boom');
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });
});
