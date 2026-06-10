import { describe, expect, test } from 'bun:test';
import * as plenipo from './index.js';

describe('public SDK exports', () => {
  test('root import surface exposes stable SDK entrypoints', () => {
    expect(plenipo.PLENIPO_SDK_VERSION).toBe('0.0.1');
    expect(plenipo.PlenipoClient).toBeDefined();
    expect(plenipo.PlenipoSidecarClient).toBeDefined();
    expect(plenipo.PlenipoAgentRuntime).toBeDefined();
    expect(plenipo.buildReceipt).toBeDefined();
    expect(plenipo.discoverAgents).toBeDefined();
  });
});
