import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { plenipoHome } from '../identity/store.js';

/** Returns the default sidecar bearer token file path. */
export function sidecarTokenPath(): string {
  return join(plenipoHome(), 'sidecar-token');
}

/** Generates a cryptographically secure bearer token. */
export function generateSidecarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString('base64url');
}

/** Reads a bearer token from disk when present. */
export function readSidecarTokenFile(path = sidecarTokenPath()): string | null {
  if (!existsSync(path)) {
    return null;
  }
  const token = readFileSync(path, 'utf8').trim();
  return token || null;
}

/** Persists a bearer token with restrictive permissions where supported. */
export function writeSidecarTokenFile(token: string, path = sidecarTokenPath()): string {
  mkdirSync(plenipoHome(), { recursive: true });
  writeFileSync(path, `${token.trim()}\n`, 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on Windows.
  }
  return path;
}

/** Resolves the sidecar bearer token with priority: CLI > env > file > generated. */
export function resolveSidecarToken(options?: {
  cliToken?: string | null;
  envToken?: string | null;
  noAuth?: boolean;
  generateIfMissing?: boolean;
}): { token: string | null; tokenPath: string; generated: boolean } {
  const tokenPath = sidecarTokenPath();
  if (options?.noAuth) {
    return { token: null, tokenPath, generated: false };
  }
  if (options?.cliToken) {
    return { token: options.cliToken.trim(), tokenPath, generated: false };
  }
  const env = options?.envToken ?? process.env.PLENIPO_SIDECAR_TOKEN;
  if (env) {
    return { token: env.trim(), tokenPath, generated: false };
  }
  const existing = readSidecarTokenFile(tokenPath);
  if (existing) {
    return { token: existing, tokenPath, generated: false };
  }
  if (options?.generateIfMissing !== false) {
    const token = generateSidecarToken();
    writeSidecarTokenFile(token, tokenPath);
    return { token, tokenPath, generated: true };
  }
  return { token: null, tokenPath, generated: false };
}

/** Compares bearer tokens in constant time. */
export function constantTimeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
