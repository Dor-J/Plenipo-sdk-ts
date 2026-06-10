import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSidecarConfigFile,
  resolveSidecarConfig,
  validateTlsConfig,
} from './config.js';

const trackedEnv = [
  'PLENIPO_SIDECAR_PORT',
  'PLENIPO_SIDECAR_ALLOWED_ORIGINS',
  'PLENIPO_SIDECAR_CONFIG',
] as const;
const originalEnv = new Map<string, string | undefined>(
  trackedEnv.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of trackedEnv) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe('sidecar config resolution', () => {
  it('applies CLI over env over JSON config over defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plenipo-sidecar-config-'));
    const configPath = join(dir, 'sidecar.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        sidecar: {
          host: '127.0.0.2',
          port: 9000,
          capability: 'file-cap',
          allowed_origins: ['http://file.example'],
          tls_cert: '/certs/file.crt',
          tls_key: '/certs/file.key',
        },
      }),
      'utf8',
    );
    process.env.PLENIPO_SIDECAR_PORT = '9100';
    process.env.PLENIPO_SIDECAR_ALLOWED_ORIGINS = 'http://env.example';

    const config = resolveSidecarConfig({
      configPath,
      cliConfig: {
        host: '127.0.0.3',
        capability: 'cli-cap',
        allowedOrigins: ['http://cli.example'],
      },
    });

    expect(config.host).toBe('127.0.0.3');
    expect(config.port).toBe(9100);
    expect(config.capability).toBe('cli-cap');
    expect(config.allowedOrigins).toEqual(['http://cli.example']);
    expect(config.tlsCert).toBe('/certs/file.crt');
  });

  it('loads top-level JSON config keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plenipo-sidecar-config-'));
    const configPath = join(dir, 'sidecar.json');
    writeFileSync(configPath, JSON.stringify({ host: '127.0.0.4' }), 'utf8');
    expect(loadSidecarConfigFile(configPath).host).toBe('127.0.0.4');
  });

  it('requires TLS cert and key together', () => {
    expect(() => validateTlsConfig({ tlsCert: '/certs/local.crt', tlsKey: null })).toThrow(
      /tls-cert/,
    );
  });
});
