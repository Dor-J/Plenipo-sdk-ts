import { describe, expect, it } from 'bun:test';
import { createPlenipoMcpServer } from '../index.js';

describe('createPlenipoMcpServer', () => {
  it('creates a server instance', () => {
    const server = createPlenipoMcpServer();
    expect(server).toBeDefined();
  });
});
