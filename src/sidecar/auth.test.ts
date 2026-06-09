import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  constantTimeTokenMatch,
  generateSidecarToken,
  readSidecarTokenFile,
  resolveSidecarToken,
  writeSidecarTokenFile,
} from './auth.js';

describe('sidecar auth', () => {
  it('generates and resolves tokens with constant-time compare', () => {
    const token = generateSidecarToken();
    expect(token.length).toBeGreaterThan(20);
    expect(constantTimeTokenMatch(token, token)).toBe(true);
    expect(constantTimeTokenMatch(token, `${token}x`)).toBe(false);
  });

  it('writes and reads token file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plenipo-sidecar-'));
    const path = join(dir, 'sidecar-token');
    writeSidecarTokenFile('test-token-value', path);
    expect(readSidecarTokenFile(path)).toBe('test-token-value');
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves token priority cli > env > file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plenipo-sidecar-'));
    const path = join(dir, 'sidecar-token');
    writeSidecarTokenFile('file-token', path);
    const fromCli = resolveSidecarToken({ cliToken: 'cli-token' });
    expect(fromCli.token).toBe('cli-token');
    const fromEnv = resolveSidecarToken({ envToken: 'env-token' });
    expect(fromEnv.token).toBe('env-token');
    rmSync(dir, { recursive: true, force: true });
  });
});
