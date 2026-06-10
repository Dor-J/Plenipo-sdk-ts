import { serve } from 'bun';
import { readFileSync } from 'node:fs';
import { declareRoute, defaultRouteServiceFields } from '../identity/route.js';
import { PlenipoAgentRuntime } from '../runtime/agent.js';
import { resolveSidecarToken } from './auth.js';
import { createSidecarApp } from './app.js';
import {
  allowedOriginsFromConfig,
  NO_AUTH_WARNING,
  remoteBindWarning,
  type SidecarConfig,
  type SidecarSecurity,
  validateBindHost,
  validateNoAuthBind,
  validateTlsConfig,
} from './config.js';
import { consumeRuntimeEvents, DurableEventService } from './events.js';

export interface SidecarHandle {
  runtime: PlenipoAgentRuntime;
  eventBuffer: DurableEventService;
  security: SidecarSecurity;
  stop: () => Promise<void>;
}

/** Starts the sidecar HTTP server. Requires Bun. */
export async function runSidecar(config: SidecarConfig): Promise<SidecarHandle> {
  validateBindHost(config.host, config.allowRemoteBind);
  validateNoAuthBind(config.host, config.noAuth);
  validateTlsConfig(config);
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host.trim().toLowerCase())) {
    console.warn(remoteBindWarning(config.host));
  }

  const runtime = new PlenipoAgentRuntime();
  await runtime.ensureReady();

  const defaults = defaultRouteServiceFields();
  const capabilities = [...new Set(['general', config.capability])];
  await declareRoute({
    protocols: [config.protocol],
    capabilities,
    payment: defaults.payment,
    limits: defaults.limits,
  });
  await runtime.afterRouteDeclared();

  const eventBuffer = new DurableEventService(runtime.store);
  const eventTask = consumeRuntimeEvents(runtime.events(), eventBuffer);

  const { token, tokenPath, generated } = resolveSidecarToken({
    cliToken: config.token,
    noAuth: config.noAuth,
    generateIfMissing: !config.noAuth,
  });

  if (config.noAuth) {
    console.warn(NO_AUTH_WARNING);
  } else if (generated) {
    console.info(`Plenipo sidecar token written to ${tokenPath}`);
  } else {
    console.info(`Plenipo sidecar using token file ${tokenPath}`);
  }
  if (config.printToken && token) {
    console.warn(`Sidecar bearer token: ${token}`);
  }

  const security: SidecarSecurity = {
    authEnabled: !config.noAuth,
    token,
    signedRequestSecret: config.signedRequestSecret ?? process.env.PLENIPO_SIDECAR_SIGNING_SECRET ?? null,
    allowedOrigins: allowedOriginsFromConfig(config),
  };

  const app = createSidecarApp({ runtime, eventBuffer, security });
  const tls =
    config.tlsCert && config.tlsKey
      ? {
          cert: readFileSync(config.tlsCert, 'utf8'),
          key: readFileSync(config.tlsKey, 'utf8'),
        }
      : undefined;
  const server = serve({
    hostname: config.host,
    port: config.port,
    fetch: app.fetch,
    ...(tls ? { tls } : {}),
  });

  const scheme = tls ? 'https' : 'http';
  console.info(`Plenipo sidecar listening on ${scheme}://${config.host}:${config.port}`);

  return {
    runtime,
    eventBuffer,
    security,
    stop: async () => {
      server.stop();
      await runtime.close();
      await eventTask.catch(() => undefined);
    },
  };
}
