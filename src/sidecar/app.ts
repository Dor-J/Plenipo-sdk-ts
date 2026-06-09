import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { discoverAgents } from '../discover/index.js';
import { declareRoute, routeFromDocument } from '../identity/route.js';
import type { PlenipoAgentRuntime } from '../runtime/agent.js';
import type { SidecarSecurity } from './config.js';
import { DurableEventService } from './events.js';
import { SidecarStoreKeyError } from './inboxCrypto.js';
import { authMiddleware, corsMiddleware, loggingMiddleware } from './middleware.js';
import {
  buildStatusPayload,
  outboxRecordToDict,
  publicRouteFromIdentity,
  receiptRecordToDict,
  sendAckToDict,
  SERVICE_NAME,
  SIDECAR_VERSION,
} from './models.js';

export interface SidecarContext {
  runtime: PlenipoAgentRuntime;
  eventBuffer: DurableEventService;
  security: SidecarSecurity;
}

/** Builds the Hono sidecar application. */
export function createSidecarApp(ctx: SidecarContext): Hono {
  const app = new Hono();

  app.use('*', loggingMiddleware());
  app.use('*', corsMiddleware(ctx.security.allowedOrigins));
  app.use('*', authMiddleware(ctx.security));

  app.get('/health', (c) =>
    c.json({ ok: true, service: SERVICE_NAME, version: SIDECAR_VERSION }),
  );

  app.get('/status', (c) => {
    const identity = ctx.runtime.getIdentity();
    if (!identity) {
      return c.json({ error: 'runtime not ready' }, 503);
    }
    const client = ctx.runtime.getClient();
    return c.json(
      buildStatusPayload({
        identity,
        connected: Boolean(client?.connected),
        store: ctx.runtime.store,
      }),
    );
  });

  app.get('/route', (c) => {
    const identity = ctx.runtime.getIdentity();
    if (!identity) {
      return c.json({ error: 'runtime not ready' }, 503);
    }
    return c.json(publicRouteFromIdentity(identity));
  });

  app.post('/route', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const updated = await declareRoute(
      {
        protocols: stringList(body.protocols),
        capabilities: stringList(body.capabilities),
        payment: typeof body.payment === 'object' ? (body.payment as never) : undefined,
        limits: typeof body.limits === 'object' ? (body.limits as never) : undefined,
      },
      { replace: Boolean(body.replace) },
    );
    return c.json({
      did: updated.did,
      route: routeFromDocument(updated.document),
      core_registered: updated.coreRegistered,
    });
  });

  app.get('/discover', async (c) => {
    const params = c.req.query();
    const onlineRaw = params.online;
    const results = await discoverAgents({
      query: params.query,
      capability: params.capability,
      protocol: params.protocol,
      paymentScheme: params.payment_scheme,
      maxPricePerKbTokens: params.max_price_per_kb_tokens
        ? Number(params.max_price_per_kb_tokens)
        : undefined,
      online: onlineRaw ? ['1', 'true', 'yes'].includes(onlineRaw.toLowerCase()) : undefined,
      limit: params.limit ? Number(params.limit) : 20,
    });
    return c.json({ results });
  });

  app.post('/send', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const recipientDid = body.recipient_did;
    const message = body.message;
    if (typeof recipientDid !== 'string' || !recipientDid) {
      return c.json({ error: 'recipient_did is required' }, 400);
    }
    if (typeof message !== 'string') {
      return c.json({ error: 'message is required' }, 400);
    }
    try {
      const ack = await ctx.runtime.send(
        recipientDid,
        message,
        typeof body.recipient_document_url === 'string' ? body.recipient_document_url : null,
        {
          envelopeId: typeof body.envelope_id === 'string' ? body.envelope_id : undefined,
        },
      );
      return c.json(sendAckToDict(ack as unknown as Record<string, unknown>));
    } catch (error) {
      return c.json({ error: String(error) }, 502);
    }
  });

  app.get('/events', async (c) => {
    const afterId = parseAfterId(c.req.query(), c.req.header('last-event-id'));
    const timeoutMs = Math.min(Math.max(Number(c.req.query('timeout_ms') ?? '1000'), 0), 60_000);
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '100'), 1), 100);
    const includePlaintext = parseBool(c.req.query('include_plaintext'), true);

    try {
      const result = await ctx.eventBuffer.waitForEvents({
        afterId,
        timeoutMs,
        limit,
        includePlaintext,
      });
      return c.json({
        events: result.events,
        next_after_id: result.nextAfterId,
        since_id: result.nextAfterId,
      });
    } catch (error) {
      if (error instanceof SidecarStoreKeyError) {
        return c.json({ error: String(error) }, 500);
      }
      throw error;
    }
  });

  app.get('/events/stream', (c) =>
    streamSSE(c, async (stream) => {
      let afterId = parseAfterId(c.req.query(), c.req.header('last-event-id'));
      const includePlaintext = parseBool(c.req.query('include_plaintext'), true);

      while (true) {
        try {
          const result = ctx.eventBuffer.listEventsAfter({
            afterId,
            limit: 50,
            includePlaintext,
          });
          if (!result.events.length) {
            await stream.sleep(500);
            continue;
          }
          for (const event of result.events) {
            const eventId = String(event.id ?? afterId);
            await stream.writeSSE({
              id: eventId,
              event: String(event.type ?? 'event'),
              data: JSON.stringify(event),
            });
          }
          afterId = result.nextAfterId;
          await stream.sleep(100);
        } catch (error) {
          if (error instanceof SidecarStoreKeyError) {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({ error: String(error) }),
            });
          }
          break;
        }
      }
    }),
  );

  app.get('/outbox', (c) => {
    const status = c.req.query('status');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '100'), 1), 500);
    const rows = ctx.runtime.outbox({ status, limit });
    return c.json({ outbox: rows.map(outboxRecordToDict) });
  });

  app.get('/receipts', (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '100'), 1), 500);
    const rows = ctx.runtime.receipts(limit);
    return c.json({ receipts: rows.map(receiptRecordToDict) });
  });

  return app;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map(String);
}

function parseAfterId(
  params: Record<string, string | undefined>,
  lastEventId?: string,
): number {
  if (lastEventId) {
    const parsed = Number(lastEventId);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  if (params.after_id !== undefined) {
    return Number(params.after_id ?? '0');
  }
  return Number(params.since_id ?? '0');
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}
