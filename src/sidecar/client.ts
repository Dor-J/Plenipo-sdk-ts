/** HTTP client for the Plenipo agent sidecar local API. */

export class SidecarClientError extends Error {}

export interface SidecarClientOptions {
  baseUrl?: string;
  token?: string | null;
  timeoutMs?: number;
}

/** Synchronous-style client for the local Plenipo sidecar HTTP API. */
export class PlenipoSidecarClient {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly timeoutMs: number;

  constructor(options: SidecarClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
    this.token = options.token ?? null;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Creates a client from PLENIPO_SIDECAR_URL and token env/file. */
  static async fromEnv(): Promise<PlenipoSidecarClient> {
    const { readSidecarTokenFile } = await import('./auth.js');
    const baseUrl = process.env.PLENIPO_SIDECAR_URL ?? 'http://127.0.0.1:8787';
    const token = process.env.PLENIPO_SIDECAR_TOKEN ?? readSidecarTokenFile();
    return new PlenipoSidecarClient({ baseUrl, token });
  }

  health(): Promise<Record<string, unknown>> {
    return this.request('GET', '/health', { auth: false });
  }

  status(): Promise<Record<string, unknown>> {
    return this.request('GET', '/status');
  }

  route(): Promise<Record<string, unknown>> {
    return this.request('GET', '/route');
  }

  declareRoute(route: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request('POST', '/route', { body: route });
  }

  discover(options: {
    query?: string;
    capability?: string;
    protocol?: string;
    paymentScheme?: string;
    maxPricePerKbTokens?: number;
    online?: boolean;
    limit?: number;
  } = {}): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    params.set('limit', String(options.limit ?? 20));
    if (options.query) params.set('query', options.query);
    if (options.capability) params.set('capability', options.capability);
    if (options.protocol) params.set('protocol', options.protocol);
    if (options.paymentScheme) params.set('payment_scheme', options.paymentScheme);
    if (options.maxPricePerKbTokens !== undefined) {
      params.set('max_price_per_kb_tokens', String(options.maxPricePerKbTokens));
    }
    if (options.online) params.set('online', 'true');
    return this.request('GET', `/discover?${params.toString()}`);
  }

  send(
    recipientDid: string,
    message: string,
    options?: { recipientDocumentUrl?: string; envelopeId?: string },
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { recipient_did: recipientDid, message };
    if (options?.recipientDocumentUrl) {
      body.recipient_document_url = options.recipientDocumentUrl;
    }
    if (options?.envelopeId) {
      body.envelope_id = options.envelopeId;
    }
    return this.request('POST', '/send', { body });
  }

  events(options?: {
    afterId?: number;
    sinceId?: number;
    timeoutMs?: number;
    limit?: number;
    includePlaintext?: boolean;
  }): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    const afterId = options?.afterId ?? options?.sinceId ?? 0;
    params.set('after_id', String(afterId));
    params.set('timeout_ms', String(options?.timeoutMs ?? 1000));
    params.set('limit', String(options?.limit ?? 100));
    params.set('include_plaintext', String(options?.includePlaintext !== false));
    const timeoutMs = Math.max(this.timeoutMs, (options?.timeoutMs ?? 1000) + 5000);
    return this.request('GET', `/events?${params.toString()}`, { timeoutMs });
  }

  /** Yields durable events from the SSE stream. */
  async *streamEvents(options?: {
    afterId?: number;
    includePlaintext?: boolean;
  }): AsyncGenerator<Record<string, unknown>> {
    const params = new URLSearchParams();
    params.set('after_id', String(options?.afterId ?? 0));
    params.set('include_plaintext', String(options?.includePlaintext !== false));
    const response = await fetch(`${this.baseUrl}/events/stream?${params.toString()}`, {
      headers: {
        ...this.authHeaders(),
        Accept: 'text/event-stream',
      },
    });
    if (response.status >= 400) {
      throw new SidecarClientError(
        `GET /events/stream failed with ${response.status}: ${await response.text()}`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) {
      return;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const dataLine = chunk.split('\n').find((line) => line.startsWith('data:'));
        if (dataLine) {
          const payload = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
          yield payload;
        }
      }
    }
  }

  outbox(options?: { status?: string; limit?: number }): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    params.set('limit', String(options?.limit ?? 100));
    if (options?.status) params.set('status', options.status);
    return this.request('GET', `/outbox?${params.toString()}`);
  }

  receipts(limit = 100): Promise<Record<string, unknown>> {
    return this.request('GET', `/receipts?limit=${limit}`);
  }

  private authHeaders(): Record<string, string> {
    if (this.token) {
      return { Authorization: `Bearer ${this.token}` };
    }
    return {};
  }

  private async request(
    method: string,
    path: string,
    options?: { body?: Record<string, unknown>; auth?: boolean; timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      ...(options?.auth === false ? {} : this.authHeaders()),
    };
    if (options?.body) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options?.timeoutMs ?? this.timeoutMs),
    });
    if (response.status >= 400) {
      throw new SidecarClientError(`${method} ${path} failed with ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as unknown;
    if (body && typeof body === 'object') {
      return body as Record<string, unknown>;
    }
    throw new SidecarClientError(`${method} ${path} returned non-object JSON`);
  }
}
