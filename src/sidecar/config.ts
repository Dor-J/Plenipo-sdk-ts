export const LOCALHOST_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export const NO_AUTH_WARNING =
  'WARNING: Plenipo sidecar running with --no-auth. Local API is unauthenticated. Use only on localhost for development.';

export interface SidecarConfig {
  host: string;
  port: number;
  capability: string;
  protocol: string;
  allowRemoteBind: boolean;
  eventBufferSize: number;
  token: string | null;
  noAuth: boolean;
  printToken: boolean;
  allowedOrigins: string[];
}

export interface SidecarSecurity {
  authEnabled: boolean;
  token: string | null;
  allowedOrigins: Set<string>;
}

export const DEFAULT_SIDECAR_CONFIG: SidecarConfig = {
  host: '127.0.0.1',
  port: 8787,
  capability: 'mcp',
  protocol: 'plenipo.message.v1',
  allowRemoteBind: false,
  eventBufferSize: 100,
  token: null,
  noAuth: false,
  printToken: false,
  allowedOrigins: [],
};

export function isLocalhostHost(host: string): boolean {
  return LOCALHOST_HOSTS.has(host.trim().toLowerCase());
}

export function parseAllowedOrigins(...values: Array<string | undefined>): string[] {
  const origins: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      if (trimmed) {
        origins.push(trimmed);
      }
    }
  }
  return [...new Set(origins)];
}

export function allowedOriginsFromConfig(config: SidecarConfig): Set<string> {
  const envOrigins = process.env.PLENIPO_SIDECAR_ALLOWED_ORIGINS;
  return new Set(parseAllowedOrigins(envOrigins, ...config.allowedOrigins));
}

export function validateBindHost(host: string, allowRemoteBind: boolean): void {
  if (!isLocalhostHost(host) && !allowRemoteBind) {
    throw new Error(
      `Binding to '${host}' requires --allow-remote-bind for safety. Default is localhost-only.`,
    );
  }
}

export function validateNoAuthBind(host: string, noAuth: boolean): void {
  if (noAuth && !isLocalhostHost(host)) {
    throw new Error(`--no-auth cannot be used when binding to '${host}'. Authentication is required for non-localhost binds.`);
  }
}

export function remoteBindWarning(host: string): string {
  return (
    `WARNING: Plenipo sidecar binding to ${host} — ` +
    'local API may expose decrypted messages to the network. Use localhost unless you understand the risk.'
  );
}
