export { declareCapabilities } from './capabilities.js';
export {
  createLocalIdentity,
  ensureIdentity,
  identityToMcpConfig,
  provisionIdentity,
} from './provision.js';
export { registerDocument } from './register.js';
export {
  buildRegisterPayload,
  documentFingerprint,
  signRegisterPayload,
  signRotationPayload,
} from './registerSigning.js';
export {
  syncIdentityWithCore,
  syncResultToDict,
  type SyncIdentityResult,
} from './sync.js';
export {
  coreHostedDocumentUrl,
  externalDidWebDocumentUrl,
  isCoreHostedLocalDid,
  validateProductionDidWeb,
} from './urls.js';
export {
  identityFromCreateResult,
  identityPath,
  loadIdentity,
  plenipoHome,
  saveIdentity,
  type AgentIdentity,
  type DidDocumentMode,
} from './store.js';
