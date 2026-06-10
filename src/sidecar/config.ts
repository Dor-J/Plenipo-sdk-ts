import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plenipoHome } from '../identity/store.js';

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
  signedRequestSecret: string | null;
  noAuth: boolean;
  printToken: boolean;
  allowedOrigins: string[];
  tlsCert: string | null;
  tlsKey: string | null;
  logLevel: string;
}

export interface SidecarSecurity {
  authEnabled: boolean;
  token: string | null;
  signedRequestSecret?: string | null;
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
  signedRequestSecret: null,
  noAuth: false,
  printToken: false,
  allowedOrigins: [],
  tlsCert: null,
  tlsKey: null,
  logLevel: 'info',
};

export interface SidecarCliConfig {
  host?: string;
  port?: number;
  capability?: string;
  protocol?: string;
  allowRemoteBind?: boolean;
  eventBufferSize?: number;
  token?: string | null;
  signedRequestSecret?: string | null;
  noAuth?: boolean;
  printToken?: boolean;
  allowedOrigins?: string[];
  tlsCert?: string | null;
  tlsKey?: string | null;
  logLevel?: string;
}

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

export function sidecarConfigPath(override?: string): string {
  if (override) {
    return override;
  }
  if (process.env.PLENIPO_SIDECAR_CONFIG) {
    return process.env.PLENIPO_SIDECAR_CONFIG;
  }
  return join(plenipoHome(), 'sidecar.json');
}

export function loadSidecarConfigFile(path?: string, required = false): Record<string, unknown> {
  const target = sidecarConfigPath(path);
  if (!existsSync(target)) {
    if (required) {
      throw new Error(`Sidecar config file not found: ${target}`);
    }
    return {};
  }
  const parsed = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
  const section = parsed.sidecar;
  return typeof section === 'object' && section !== null && !Array.isArray(section)
    ? (section as Record<string, unknown>)
    : parsed;
}

export function resolveSidecarConfig(options?: {
  configPath?: string;
  cliConfig?: SidecarCliConfig;
}): SidecarConfig {
  const values: Record<keyof SidecarConfig, unknown> = {
    ...DEFAULT_SIDECAR_CONFIG,
    allowedOrigins: [...DEFAULT_SIDECAR_CONFIG.allowedOrigins],
  };
  Object.assign(values, coerceFileValues(loadSidecarConfigFile(options?.configPath)));
  Object.assign(values, envValues());
  if (options?.cliConfig) {
    for (const [key, value] of Object.entries(options.cliConfig)) {
      if (value !== undefined) {
        values[key as keyof SidecarConfig] = value;
      }
    }
  }

  return {
    host: String(values.host),
    port: Number(values.port),
    capability: String(values.capability),
    protocol: String(values.protocol),
    allowRemoteBind: boolValue(values.allowRemoteBind),
    eventBufferSize: Number(values.eventBufferSize),
    token: optionalString(values.token),
    signedRequestSecret: optionalString(values.signedRequestSecret),
    noAuth: boolValue(values.noAuth),
    printToken: boolValue(values.printToken),
    allowedOrigins: originsValue(values.allowedOrigins),
    tlsCert: optionalString(values.tlsCert),
    tlsKey: optionalString(values.tlsKey),
    logLevel: String(values.logLevel),
  };
}

export function allowedOriginsFromConfig(config: SidecarConfig): Set<string> {
  return new Set(config.allowedOrigins);
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

export function validateTlsConfig(config: Pick<SidecarConfig, 'tlsCert' | 'tlsKey'>): void {
  if (Boolean(config.tlsCert) !== Boolean(config.tlsKey)) {
    throw new Error('--tls-cert and --tls-key must be provided together');
  }
}

export function remoteBindWarning(host: string): string {
  return (
    `WARNING: Plenipo sidecar binding to ${host} — ` +
    'local API may expose decrypted messages to the network. Use localhost unless you understand the risk.'
  );
}

function normalizeKey(key: string): string {
  return key.replaceAll('-', '_');
}

function coerceFileValues(raw: Record<string, unknown>): Partial<Record<keyof SidecarConfig, unknown>> {
  const supported: Record<string, keyof SidecarConfig> = {
    host: 'host',
    port: 'port',
    capability: 'capability',
    protocol: 'protocol',
    allow_remote_bind: 'allowRemoteBind',
    allowRemoteBind: 'allowRemoteBind',
    event_buffer_size: 'eventBufferSize',
    eventBufferSize: 'eventBufferSize',
    token: 'token',
    signed_request_secret: 'signedRequestSecret',
    signedRequestSecret: 'signedRequestSecret',
    no_auth: 'noAuth',
    noAuth: 'noAuth',
    print_token: 'printToken',
    printToken: 'printToken',
    allowed_origins: 'allowedOrigins',
    allowedOrigins: 'allowedOrigins',
    tls_cert: 'tlsCert',
    tlsCert: 'tlsCert',
    tls_key: 'tlsKey',
    tlsKey: 'tlsKey',
    log_level: 'logLevel',
    logLevel: 'logLevel',
  };
  const values: Partial<Record<keyof SidecarConfig, unknown>> = {};
  for (const [key, value] of Object.entries(raw)) {
    const target = supported[normalizeKey(key)] ?? supported[key];
    if (target) {
      values[target] = value;
    }
  }
  return values;
}

function envValues(): Partial<Record<keyof SidecarConfig, unknown>> {
  const envMap: Array<[keyof SidecarConfig, string]> = [
    ['host', 'PLENIPO_SIDECAR_HOST'],
    ['port', 'PLENIPO_SIDECAR_PORT'],
    ['capability', 'PLENIPO_SIDECAR_CAPABILITY'],
    ['protocol', 'PLENIPO_SIDECAR_PROTOCOL'],
    ['allowRemoteBind', 'PLENIPO_SIDECAR_ALLOW_REMOTE_BIND'],
    ['eventBufferSize', 'PLENIPO_SIDECAR_EVENT_BUFFER_SIZE'],
    ['token', 'PLENIPO_SIDECAR_TOKEN'],
    ['signedRequestSecret', 'PLENIPO_SIDECAR_SIGNING_SECRET'],
    ['noAuth', 'PLENIPO_SIDECAR_NO_AUTH'],
    ['printToken', 'PLENIPO_SIDECAR_PRINT_TOKEN'],
    ['allowedOrigins', 'PLENIPO_SIDECAR_ALLOWED_ORIGINS'],
    ['tlsCert', 'PLENIPO_SIDECAR_TLS_CERT'],
    ['tlsKey', 'PLENIPO_SIDECAR_TLS_KEY'],
    ['logLevel', 'PLENIPO_SIDECAR_LOG_LEVEL'],
  ];
  const values: Partial<Record<keyof SidecarConfig, unknown>> = {};
  for (const [key, envKey] of envMap) {
    const value = process.env[envKey];
    if (value) {
      values[key] = value;
    }
  }
  return values;
}

function boolValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value);
  return text.length ? text : null;
}

function originsValue(value: unknown): string[] {
  if (typeof value === 'string') {
    return parseAllowedOrigins(value);
  }
  if (Array.isArray(value)) {
    return parseAllowedOrigins(...value.map(String));
  }
  return [];
}
