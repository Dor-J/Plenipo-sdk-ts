import { PlenipoClient } from '../client/index.js';
import { decodeBase64Url } from '../crypto/base64url.js';
import { openSealed } from '../crypto/sealedBox.js';
import { resolveEncPublicKey } from '../did/resolve.js';
import type { SendAck } from '../client/index.js';

export interface McpRuntimeConfig {
  did: string;
  authSecretB64: string;
  didDocumentUrl: string;
  relayUrl: string;
  encSecretB64?: string;
  registryUrl?: string;
}

export interface BufferedMessage {
  kind: 'deliver' | 'receipt';
  envelope_id: string;
  sender_did?: string;
  recipient_did?: string;
  created_at?: string;
  ciphertext?: string;
  plaintext?: string;
  received_at?: string;
  receivedAt: string;
}

/**
 * Loads MCP agent configuration from environment variables.
 */
export function loadMcpConfigFromEnv(): McpRuntimeConfig {
  const did = process.env.PLENIPO_DID;
  const authSecretB64 =
    process.env.PLENIPO_AUTH_SECRET_B64 ?? process.env.PLENIPO_DID_PRIVATE_KEY;
  const didDocumentUrl = process.env.PLENIPO_DID_DOCUMENT_URL;
  const relayUrl = process.env.PLENIPO_RELAY_URL ?? 'ws://localhost:4000/agent/websocket';

  if (!did || !authSecretB64 || !didDocumentUrl) {
    throw new Error(
      'Missing MCP env: set PLENIPO_DID, PLENIPO_AUTH_SECRET_B64 (or PLENIPO_DID_PRIVATE_KEY), PLENIPO_DID_DOCUMENT_URL',
    );
  }

  return {
    did,
    authSecretB64,
    didDocumentUrl,
    relayUrl,
    encSecretB64: process.env.PLENIPO_ENC_SECRET_B64,
    registryUrl: process.env.PLENIPO_REGISTRY_URL,
  };
}

/**
 * Shared MCP runtime: connected client and in-memory message buffer.
 */
export class McpRuntime {
  private client?: PlenipoClient;
  private connectPromise?: Promise<void>;
  private readonly buffer: BufferedMessage[] = [];
  private readonly config: McpRuntimeConfig;

  constructor(config: McpRuntimeConfig) {
    this.config = config;
  }

  async ensureConnected(): Promise<PlenipoClient> {
    if (!this.client) {
      const encSecret = this.config.encSecretB64;
      this.client = new PlenipoClient({
        did: this.config.did,
        authSecretKey: this.config.authSecretB64,
        didDocumentUrl: this.config.didDocumentUrl,
        relayUrl: this.config.relayUrl,
        autoReceipt: true,
      });

      this.client.onMessage((envelope) => {
        const entry: BufferedMessage = {
          kind: 'deliver',
          envelope_id: envelope.envelope_id ?? '',
          sender_did: envelope.sender_did,
          recipient_did: envelope.recipient_did,
          created_at: envelope.created_at,
          ciphertext: envelope.ciphertext,
          receivedAt: new Date().toISOString(),
        };
        if (encSecret && envelope.ciphertext) {
          try {
            const plain = openSealed(envelope.ciphertext, decodeBase64Url(encSecret));
            entry.plaintext = new TextDecoder().decode(plain);
          } catch {
            // Keep ciphertext only
          }
        }
        this.buffer.push(entry);
      });

      this.client.onReceipt((payload) => {
        this.buffer.push({
          kind: 'receipt',
          envelope_id: payload.envelope_id,
          received_at: payload.received_at,
          receivedAt: new Date().toISOString(),
        });
      });
    }

    if (!this.connectPromise) {
      this.connectPromise = this.client.connect();
    }
    await this.connectPromise;
    return this.client;
  }

  async send(
    recipientDid: string,
    message: string,
    recipientDocumentUrl?: string,
  ): Promise<SendAck> {
    const client = await this.ensureConnected();
    const relayHttpUrl = client.relayHttpUrl;
    const encKey = await resolveEncPublicKey({
      recipientDid,
      recipientDocumentUrl,
      registryUrl: this.config.registryUrl,
      relayHttpUrl,
    });
    return client.send(recipientDid, message, encKey);
  }

  async getBalance(): Promise<number> {
    const client = await this.ensureConnected();
    return client.getBalance();
  }

  drainMessages(since?: string, limit = 100): BufferedMessage[] {
    const drained: BufferedMessage[] = [];
    const kept: BufferedMessage[] = [];

    for (const entry of this.buffer) {
      const eligible =
        !since ||
        entry.receivedAt > since ||
        entry.envelope_id > since ||
        (entry.created_at !== undefined && entry.created_at > since);

      if (eligible && drained.length < limit) {
        drained.push(entry);
      } else {
        kept.push(entry);
      }
    }

    this.buffer.length = 0;
    this.buffer.push(...kept);
    return drained;
  }
}

let defaultRuntime: McpRuntime | undefined;

/**
 * Returns the process-wide MCP runtime (lazy init from env).
 */
export function getMcpRuntime(): McpRuntime {
  if (!defaultRuntime) {
    defaultRuntime = new McpRuntime(loadMcpConfigFromEnv());
  }
  return defaultRuntime;
}

/** Resets runtime (for tests). */
export function resetMcpRuntime(): void {
  defaultRuntime = undefined;
}
