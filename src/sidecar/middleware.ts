import type { Context, Next } from 'hono';
import { constantTimeTokenMatch } from './auth.js';
import type { SidecarSecurity } from './config.js';

const PUBLIC_PATHS = new Set(['/health']);

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
    await next();
  };
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
