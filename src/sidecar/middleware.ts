import type { Context, Next } from 'hono';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constantTimeTokenMatch } from './auth.js';
import type { SidecarSecurity } from './config.js';

const PUBLIC_PATHS = new Set(['/health']);
const SIGNATURE_MAX_AGE_SECONDS = 300;

/** Requires bearer token on all endpoints except /health. */
export function authMiddleware(security: SidecarSecurity) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (!security.authEnabled || PUBLIC_PATHS.has(c.req.path)) {
      await next();
      return;
    }
    if (!security.token) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const authHeader = c.req.header('authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const provided = authHeader.slice(7).trim();
    if (!provided || !constantTimeTokenMatch(provided, security.token)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (security.signedRequestSecret && !(await verifySignedRequest(c, security.signedRequestSecret))) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}

export function buildSignedRequestHeaders(
  secret: string,
  method: string,
  path: string,
  body: string | Uint8Array = '',
  timestamp = Math.floor(Date.now() / 1000).toString(),
): Record<string, string> {
  const bodyBytes = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
  const digest = createHash('sha256').update(bodyBytes).digest('hex');
  const signature = sign(secret, method, path, timestamp, digest);

  return {
    'X-Plenipo-Timestamp': timestamp,
    'X-Plenipo-Signature': signature,
  };
}

async function verifySignedRequest(c: Context, secret: string): Promise<boolean> {
  const timestamp = c.req.header('x-plenipo-timestamp');
  const signature = c.req.header('x-plenipo-signature');
  if (!timestamp || !signature) {
    return false;
  }

  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }

  const body = Buffer.from(await c.req.raw.clone().arrayBuffer());
  const digest = createHash('sha256').update(body).digest('hex');
  const expected = sign(secret, c.req.method, c.req.path, timestamp, digest);
  return secureCompare(signature, expected);
}

function sign(secret: string, method: string, path: string, timestamp: string, digest: string): string {
  const payload = [method.toUpperCase(), path, timestamp, digest].join('\n');
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function secureCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Rejects browser Origin headers unless explicitly allowed. */
export function corsMiddleware(allowedOrigins: Set<string>) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const origin = c.req.header('origin');
    if (origin && !allowedOrigins.has(origin)) {
      return c.json({ error: 'origin not allowed' }, 403);
    }
    if (c.req.method === 'OPTIONS' && origin && allowedOrigins.has(origin)) {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    await next();
    if (origin && allowedOrigins.has(origin)) {
      const response = c.res;
      for (const [key, value] of Object.entries(corsHeaders(origin))) {
        response.headers.set(key, value);
      }
    }
  };
}

/** Logs method, path, status, and duration without request bodies. */
export function loggingMiddleware() {
  return async (c: Context, next: Next): Promise<void> => {
    const start = performance.now();
    await next();
    const durationMs = Math.round(performance.now() - start);
    console.info(`${c.req.method} ${c.req.path} ${c.res.status} duration_ms=${durationMs}`);
  };
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Plenipo-Timestamp, X-Plenipo-Signature',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
