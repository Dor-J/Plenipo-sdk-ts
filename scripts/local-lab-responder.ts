import { readFileSync } from 'node:fs';
import { loadMcpConfigFromEnv, McpRuntime } from '../src/mcp/runtime.js';

type Options = {
  senderDid: string;
  senderDocumentUrl?: string;
  envFile?: string;
  timeoutMs: number;
};

const options = parseArgs(Bun.argv.slice(2));
if (options.envFile) {
  loadEnvFile(options.envFile);
}

const runtime = new McpRuntime(loadMcpConfigFromEnv());
await runtime.ensureConnected();
console.log(`Responder connected as ${process.env.PLENIPO_DID}`);
console.log(`Responder balance: ${await runtime.getBalance()}`);

const deadline = Date.now() + options.timeoutMs;

while (Date.now() < deadline) {
  for (const entry of runtime.drainMessages(undefined, 100)) {
    if (entry.kind !== 'deliver' || entry.sender_did !== options.senderDid || !entry.plaintext) {
      continue;
    }

    const ping = parseJson(entry.plaintext);
    if (ping?.kind !== 'plenipo.local.ping' || typeof ping.nonce !== 'string') {
      continue;
    }

    const ack = {
      kind: 'plenipo.local.ack',
      nonce: ping.nonce,
      responder: process.env.PLENIPO_DID,
      received_envelope_id: entry.envelope_id,
    };

    const sendAck = await runtime.send(
      options.senderDid,
      JSON.stringify(ack),
      options.senderDocumentUrl,
    );
    console.log(`Ack sent with envelope ${sendAck.envelope_id} (${sendAck.status}).`);
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
}

throw new Error(`Timed out waiting for ping from ${options.senderDid}`);

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith('--')) {
      usage();
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      usage();
    }

    values.set(key.slice(2), value);
    index += 1;
  }

  const senderDid = values.get('sender-did');
  if (!senderDid) {
    usage();
  }

  return {
    senderDid,
    senderDocumentUrl: values.get('sender-document-url'),
    envFile: values.get('env'),
    timeoutMs: Number.parseInt(values.get('timeout-ms') ?? '120000', 10),
  };
}

function loadEnvFile(path: string) {
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const index = line.indexOf('=');
    if (index === -1) {
      continue;
    }

    process.env[line.slice(0, index)] = line.slice(index + 1);
  }
}

function parseJson(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function usage(): never {
  console.error(
    [
      'Usage:',
      '  bun run local-lab:responder -- --env .plenipo-local/typescript-b/private.env --sender-did did:web:agents.example.com:local:python-a --sender-document-url https://agents.example.com/local/python-a/did.json',
    ].join('\n'),
  );
  process.exit(2);
}
