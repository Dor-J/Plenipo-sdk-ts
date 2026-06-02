import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDidDocument } from '../src/did/create.js';

type Options = {
  host: string;
  path: string;
  relayUrl: string;
  registryUrl: string;
  outDir: string;
};

const options = parseArgs(Bun.argv.slice(2));
const pathSegments = splitPath(options.path);
const identity = await createDidDocument(options.host, {
  pathSegments,
  relayUrl: options.relayUrl,
});

const outDir = resolve(process.cwd(), options.outDir);
mkdirSync(outDir, { recursive: true });

const publicPath = resolve(outDir, 'did.json');
const envPath = resolve(outDir, 'private.env');

writeFileSync(publicPath, JSON.stringify(identity.document, null, 2) + '\n', { encoding: 'utf8' });
writeFileSync(envPath, privateEnv(identity.did, identity.documentUrl, options), {
  encoding: 'utf8',
  mode: 0o600,
});

console.log(`DID: ${identity.did}`);
console.log(`Public DID document: ${publicPath}`);
console.log(`Private env file: ${envPath}`);
console.log('Private keys were written only to the private env file. Do not commit it.');

function privateEnv(did: string, documentUrl: string, opts: Options): string {
  const allowInsecureRelay = opts.relayUrl.startsWith('ws://') && !isLoopbackRelay(opts.relayUrl);

  return [
    `PLENIPO_DID=${did}`,
    `PLENIPO_AUTH_SECRET_B64=${identity.privateKeys.authSecretKey}`,
    `PLENIPO_ENC_SECRET_B64=${identity.privateKeys.encSecretKey}`,
    `PLENIPO_DID_DOCUMENT_URL=${documentUrl}`,
    `PLENIPO_RELAY_URL=${opts.relayUrl}`,
    `PLENIPO_REGISTRY_URL=${opts.registryUrl}`,
    allowInsecureRelay ? 'PLENIPO_ALLOW_INSECURE_RELAY=true' : undefined,
    '',
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) {
      usage();
    }
    values.set(key.slice(2), value);
  }

  const host = values.get('host');
  const path = values.get('path');
  const relayUrl = values.get('relay-url');
  const registryUrl = values.get('registry-url');

  if (!host || !path || !relayUrl || !registryUrl) {
    usage();
  }

  return {
    host,
    path,
    relayUrl,
    registryUrl,
    outDir: values.get('out') ?? `.plenipo-local/${path.replace(/[/:\\]/g, '-')}`,
  };
}

function splitPath(path: string): string[] {
  return path
    .split(/[/:]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function isLoopbackRelay(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function usage(): never {
  console.error(
    [
      'Usage:',
      '  bun run local-lab:identity -- --host agents.example.com --path local/typescript-b --relay-url ws://192.168.0.251:4000/agent/websocket --registry-url http://192.168.0.251:4001',
    ].join('\n'),
  );
  process.exit(2);
}
