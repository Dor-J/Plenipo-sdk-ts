import { describe, expect, test } from 'bun:test';
import { createDidDocument } from './create.js';

describe('createDidDocument', () => {
  test('builds did:web with two verification methods', async () => {
    const { did, document } = await createDidDocument('agent.example.com');
    expect(did).toBe('did:web:agent.example.com');
    const vms = document.verificationMethod as Array<{ type: string }>;
    expect(vms).toHaveLength(2);
    const [service] = document.service as Array<{ type: string }>;
    expect(service?.type).toBe('PlenipoAgent');
  });
});
