import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { authMiddleware, buildSignedRequestHeaders, corsMiddleware } from './middleware.js';

describe('sidecar middleware', () => {
  it('allows /health without auth', async () => {
    const app = new Hono();
    app.use('*', authMiddleware({ authEnabled: true, token: 'secret', allowedOrigins: new Set() }));
    app.get('/health', (c) => c.json({ ok: true }));
    const response = await app.request('/health');
    expect(response.status).toBe(200);
  });

  it('rejects unauthenticated protected routes', async () => {
    const app = new Hono();
    app.use('*', authMiddleware({ authEnabled: true, token: 'secret', allowedOrigins: new Set() }));
    app.get('/status', (c) => c.json({ ok: true }));
    const response = await app.request('/status');
    expect(response.status).toBe(401);
  });

  it('accepts bearer token', async () => {
    const app = new Hono();
    app.use('*', authMiddleware({ authEnabled: true, token: 'secret', allowedOrigins: new Set() }));
    app.get('/status', (c) => c.json({ ok: true }));
    const response = await app.request('/status', {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(response.status).toBe(200);
  });

  it('rejects unsigned requests when signed request mode is enabled', async () => {
    const app = new Hono();
    app.use(
      '*',
      authMiddleware({
        authEnabled: true,
        token: 'secret',
        signedRequestSecret: 'signing-secret',
        allowedOrigins: new Set(),
      }),
    );
    app.post('/send', (c) => c.json({ ok: true }));
    const response = await app.request('/send', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({ message: 'hi' }),
    });
    expect(response.status).toBe(401);
  });

  it('accepts signed requests when signed request mode is enabled', async () => {
    const app = new Hono();
    const body = JSON.stringify({ message: 'hi' });
    app.use(
      '*',
      authMiddleware({
        authEnabled: true,
        token: 'secret',
        signedRequestSecret: 'signing-secret',
        allowedOrigins: new Set(),
      }),
    );
    app.post('/send', async (c) => c.json(await c.req.json()));

    const response = await app.request('/send', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
        ...buildSignedRequestHeaders('signing-secret', 'POST', '/send', body),
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'hi' });
  });

  it('rejects disallowed browser origins', async () => {
    const app = new Hono();
    app.use('*', corsMiddleware(new Set(['https://allowed.example'])));
    app.get('/status', (c) => c.json({ ok: true }));
    const response = await app.request('/status', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
  });
});
