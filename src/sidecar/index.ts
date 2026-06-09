export { PlenipoSidecarClient, SidecarClientError } from './client.js';
export {
  encryptPlaintext,
  decryptPlaintext,
  resolveSidecarStoreKey,
  SidecarStoreKeyError,
  PLAINTEXT_ALG,
} from './inboxCrypto.js';
export { DurableEventService, EventBuffer } from './events.js';
export {
  resolveSidecarToken,
  readSidecarTokenFile,
  sidecarTokenPath,
  writeSidecarTokenFile,
} from './auth.js';
export {
  DEFAULT_SIDECAR_CONFIG,
  type SidecarConfig,
  type SidecarSecurity,
} from './config.js';
export { runSidecar, type SidecarHandle } from './server.js';
