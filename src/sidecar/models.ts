import type { AgentIdentity } from '../identity/store.js';
import { routeFromDocument } from '../identity/route.js';
import type { RuntimeStore, SidecarEventRecord } from '../runtime/store.js';
import { decryptPlaintext } from './inboxCrypto.js';
import { loadRuntimeState } from '../runtime/state.js';
import type {
  AgentEvent,
  DeliveryReceiptEvent,
  MessageEvent,
} from '../runtime/events.js';

export const SIDECAR_VERSION = '0.3.1';
export const SERVICE_NAME = 'plenipo-agent-sidecar';

export function publicRouteFromIdentity(identity: AgentIdentity): Record<string, unknown> {
  const route = routeFromDocument(identity.document);
  return {
    did: identity.did,
    protocols: route.protocols,
    capabilities: route.capabilities,
    encryption: route.encryption,
    payment: route.payment,
    limits: route.limits,
  };
}

export function outboxRecordToDict(row: {
  envelopeId: string;
  recipientDid: string;
  recipientDocumentUrl: string | null;
  createdAt: string;
  status: string;
  ciphertextBytes: number | null;
  billableKb: number | null;
  chargedTokens: number | null;
  balanceAfter: number | null;
  sentAt: string | null;
  deliveredAt: string | null;
  lastError: string | null;
}): Record<string, unknown> {
  return {
    envelope_id: row.envelopeId,
    recipient_did: row.recipientDid,
    recipient_document_url: row.recipientDocumentUrl,
    created_at: row.createdAt,
    status: row.status,
    ciphertext_bytes: row.ciphertextBytes,
    billable_kb: row.billableKb,
    charged_tokens: row.chargedTokens,
    balance_after: row.balanceAfter,
    sent_at: row.sentAt,
    delivered_at: row.deliveredAt,
    last_error: row.lastError,
  };
}

export function receiptRecordToDict(row: {
  envelopeId: string;
  senderDid: string;
  recipientDid: string;
  ciphertextBytes: number | null;
  billableKb: number | null;
  chargedTokens: number | null;
  balanceAfter: number | null;
  receivedAt: string | null;
  deliveredAt: string | null;
}): Record<string, unknown> {
  return {
    envelope_id: row.envelopeId,
    sender_did: row.senderDid,
    recipient_did: row.recipientDid,
    ciphertext_bytes: row.ciphertextBytes,
    billable_kb: row.billableKb,
    charged_tokens: row.chargedTokens,
    balance_after: row.balanceAfter,
    received_at: row.receivedAt,
    delivered_at: row.deliveredAt,
  };
}

/** Maps a durable sidecar event row to an API response object. */
export function sidecarEventToApiDict(
  row: SidecarEventRecord,
  options: {
    store: RuntimeStore;
    includePlaintext?: boolean;
    storeKey?: Uint8Array | null;
  },
): Record<string, unknown> {
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
  const eventType = String(payload.type ?? row.eventType);
  const result: Record<string, unknown> = {
    id: row.id,
    type: eventType,
  };

  if (eventType === 'message') {
    result.envelope_id = payload.envelope_id;
    result.sender_did = payload.sender_did;
    result.recipient_did = payload.recipient_did;
    result.received_at = payload.received_at;
    const plaintextRef = payload.plaintext_ref;
    if (
      options.includePlaintext !== false &&
      typeof plaintextRef === 'string' &&
      plaintextRef.startsWith('inbox:')
    ) {
      const envelopeId = plaintextRef.slice('inbox:'.length);
      const inboxRow = options.store.getInboxMessage(envelopeId);
      if (inboxRow && options.storeKey) {
        result.plaintext = decryptPlaintext(
          inboxRow.plaintextCiphertext,
          inboxRow.plaintextNonce,
          options.storeKey,
        );
      }
    } else if (options.includePlaintext === false) {
      result.has_plaintext = Boolean(payload.plaintext_ref);
    }
    return result;
  }

  if (eventType === 'delivery_receipt') {
    result.envelope_id = payload.envelope_id;
    for (const key of [
      'charged_tokens',
      'delivered_at',
      'ciphertext_bytes',
      'billable_kb',
      'balance_after',
    ]) {
      if (payload[key] !== undefined && payload[key] !== null) {
        result[key] = payload[key];
      }
    }
    return result;
  }

  return { ...result, ...payload };
}

export function eventToDict(event: AgentEvent): Record<string, unknown> | null {
  if (event.type === 'message') {
    const msg = event as MessageEvent;
    return {
      type: 'message',
      envelope_id: msg.envelopeId,
      sender_did: msg.senderDid,
      plaintext: msg.plaintext,
    };
  }
  if (event.type === 'delivery_receipt') {
    const receipt = event as DeliveryReceiptEvent;
    const payload: Record<string, unknown> = {
      type: 'delivery_receipt',
      envelope_id: receipt.envelopeId,
      charged_tokens: receipt.chargedTokens,
    };
    if (receipt.deliveredAt) {
      payload.delivered_at = receipt.deliveredAt;
    } else if (receipt.receivedAt) {
      payload.delivered_at = receipt.receivedAt;
    }
    if (receipt.ciphertextBytes !== null) {
      payload.ciphertext_bytes = receipt.ciphertextBytes;
    }
    if (receipt.billableKb !== null) {
      payload.billable_kb = receipt.billableKb;
    }
    if (receipt.balanceAfter !== null) {
      payload.balance_after = receipt.balanceAfter;
    }
    return payload;
  }
  return null;
}

export function buildStatusPayload(input: {
  identity: AgentIdentity;
  connected: boolean;
  store: RuntimeStore;
}): Record<string, unknown> {
  const state = loadRuntimeState(input.store);
  const counts = input.store.countOutboxByStatus();
  const receiptCount = input.store.listReceipts(10_000).length;
  const cursor = state.lastReceiptCursor ?? state.lastReceiptSeenAt;

  return {
    did: input.identity.did,
    connected: input.connected,
    core_registered: input.identity.coreRegistered,
    route_declared: documentHasRoute(input.identity.document),
    outbox: {
      pending: counts.pending ?? 0,
      accepted: counts.accepted ?? 0,
      delivered: counts.delivered ?? 0,
      failed: counts.failed ?? 0,
    },
    receipts: {
      count: receiptCount,
      last_cursor: cursor,
    },
    inbox: {
      count: input.store.countInboxMessages(),
      last_seen_at: state.lastMessageSeenAt,
    },
    events: {
      durable: true,
    },
    endpoints: {
      core_url: input.identity.coreUrl || process.env.PLENIPO_CORE_URL || '',
      registry_url: input.identity.registryUrl || process.env.PLENIPO_REGISTRY_URL || '',
      relay_url: input.identity.relayUrl || process.env.PLENIPO_RELAY_URL || '',
    },
  };
}

/** Builds the canonical `/events` response envelope. */
export function eventsResponse(
  events: Record<string, unknown>[],
  nextAfterId: number,
): { events: Record<string, unknown>[]; next_after_id: number; since_id: number } {
  return {
    events,
    next_after_id: nextAfterId,
    since_id: nextAfterId,
  };
}

export function sendAckToDict(ack: Record<string, unknown>): Record<string, unknown> {
  return {
    envelope_id: String(ack.envelope_id ?? ''),
    ciphertext_bytes: ack.ciphertext_bytes,
    billable_kb: ack.billable_kb,
    charged_tokens: ack.charged_tokens,
    balance_after: ack.balance_after,
    status: 'accepted',
  };
}

function documentHasRoute(document: Record<string, unknown>): boolean {
  const services = Array.isArray(document.service) ? document.service : [];
  for (const service of services) {
    if (
      typeof service === 'object' &&
      service !== null &&
      (service as Record<string, unknown>).type === 'PlenipoAgent' &&
      (service as Record<string, unknown>).protocols
    ) {
      return true;
    }
  }
  return false;
}
