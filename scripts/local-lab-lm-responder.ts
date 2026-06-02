import { readFileSync } from 'node:fs';
import { loadMcpConfigFromEnv, McpRuntime } from '../src/mcp/runtime.js';

type Options = {
  senderDid: string;
  senderDocumentUrl?: string;
  envFile?: string;
  timeoutMs: number;
  lmStudioBaseUrl: string;
  model: string;
};

const options = parseArgs(Bun.argv.slice(2));
if (options.envFile) {
  loadEnvFile(options.envFile);
}

const runtime = new McpRuntime(loadMcpConfigFromEnv());
await runtime.ensureConnected();
console.log(`LM responder connected as ${process.env.PLENIPO_DID}`);

const deadline = Date.now() + options.timeoutMs;

while (Date.now() < deadline) {
  for (const entry of runtime.drainMessages(undefined, 100)) {
    if (entry.kind !== 'deliver' || entry.sender_did !== options.senderDid || !entry.plaintext) {
      continue;
    }

    const task = parseJson(entry.plaintext);
    if (task?.kind !== 'plenipo.local.lm_task' || typeof task.nonce !== 'string') {
      continue;
    }

    const prompt = typeof task.prompt === 'string' ? task.prompt.slice(0, 2000) : '';
    const output = await callLmStudio(options, prompt);
    const response = {
      kind: 'plenipo.local.lm_response',
      nonce: task.nonce,
      responder: process.env.PLENIPO_DID,
      output: output.slice(0, 2000),
      received_envelope_id: entry.envelope_id,
    };

    const ack = await runtime.send(
      options.senderDid,
      JSON.stringify(response),
      options.senderDocumentUrl,
    );
    console.log(`LM response sent with envelope ${ack.envelope_id} (${ack.status}).`);
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
}

throw new Error(`Timed out waiting for LM task from ${options.senderDid}`);

async function callLmStudio(options: Options, prompt: string): Promise<string> {
  const response = await fetch(`${options.lmStudioBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(Math.min(options.timeoutMs, 30_000)),
    body: JSON.stringify({
      model: options.model,
      temperature: 0.2,
      max_tokens: 256,
      messages: [
        {
          role: 'system',
          content:
            'Return one concise answer. Do not start another task, call tools, or continue the conversation.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`LM Studio request failed: ${response.status}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content?.trim() || '';
}

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
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
    lmStudioBaseUrl:
      values.get('lm-studio-base-url') ?? process.env.LM_STUDIO_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    model: values.get('model') ?? process.env.LM_STUDIO_MODEL ?? 'local-model',
  };
}

function loadEnvFile(path: string) {
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const index = line.indexOf('=');
    if (index !== -1) {
      process.env[line.slice(0, index)] = line.slice(index + 1);
    }
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
      '  bun run local-lab:lm-responder -- --env .plenipo-local/typescript-b/private.env --sender-did did:web:agents.example.com:local:python-a --sender-document-url https://agents.example.com/local/python-a/did.json',
    ].join('\n'),
  );
  process.exit(2);
}
