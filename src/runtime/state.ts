import { loadLegacyRuntimeState, RuntimeStore } from './store.js';

export interface RuntimeState {
  lastReceiptSeenAt: string | null;
  lastReceiptCursor: string | null;
  lastMessageSeenAt: string | null;
  version: number;
}

/** Loads runtime state from SQLite, migrating legacy JSON if needed. */
export function loadRuntimeState(store?: RuntimeStore): RuntimeState {
  const owned = !store;
  const db = store ?? new RuntimeStore();
  try {
    const legacy = loadLegacyRuntimeState();
    if (legacy) {
      db.migrateLegacyJsonState(legacy.lastReceiptSeenAt);
      if (legacy.lastReceiptCursor) {
        db.setState('last_receipt_cursor', legacy.lastReceiptCursor);
      }
      if (legacy.lastMessageSeenAt) {
        db.setState('last_message_seen_at', legacy.lastMessageSeenAt);
      }
    }
    return {
      lastReceiptSeenAt: db.getState('last_receipt_seen_at'),
      lastReceiptCursor: db.getState('last_receipt_cursor'),
      lastMessageSeenAt: db.getState('last_message_seen_at'),
      version: 2,
    };
  } finally {
    if (owned) {
      db.close();
    }
  }
}

/** Persists runtime state to SQLite. */
export function saveRuntimeState(state: RuntimeState, store?: RuntimeStore): void {
  const owned = !store;
  const db = store ?? new RuntimeStore();
  try {
    if (state.lastReceiptSeenAt) {
      db.setState('last_receipt_seen_at', state.lastReceiptSeenAt);
    }
    if (state.lastReceiptCursor) {
      db.setState('last_receipt_cursor', state.lastReceiptCursor);
    }
    if (state.lastMessageSeenAt) {
      db.setState('last_message_seen_at', state.lastMessageSeenAt);
    }
    db.setState('version', String(state.version));
  } finally {
    if (owned) {
      db.close();
    }
  }
}

/** Updates and persists the last seen inbound message cursor. */
export function updateMessageCursor(input: {
  receivedAt?: string | null;
  envelopeId?: string | null;
  store?: RuntimeStore;
}): RuntimeState {
  const owned = !input.store;
  const db = input.store ?? new RuntimeStore();
  try {
    const state = loadRuntimeState(db);
    const timestamp = input.receivedAt ?? input.envelopeId;
    if (timestamp) {
      state.lastMessageSeenAt = timestamp;
      db.setState('last_message_seen_at', timestamp);
    }
    saveRuntimeState(state, db);
    return state;
  } finally {
    if (owned) {
      db.close();
    }
  }
}

/** Updates and persists receipt cursors. */
export function updateReceiptCursor(input: {
  deliveredAt?: string | null;
  receivedAt?: string | null;
  cursor?: string | null;
  store?: RuntimeStore;
}): RuntimeState {
  const owned = !input.store;
  const db = input.store ?? new RuntimeStore();
  try {
    const state = loadRuntimeState(db);
    const timestamp = input.deliveredAt ?? input.receivedAt;
    if (timestamp) {
      state.lastReceiptSeenAt = timestamp;
      db.setState('last_receipt_seen_at', timestamp);
    }
    if (input.cursor) {
      state.lastReceiptCursor = input.cursor;
      db.setState('last_receipt_cursor', input.cursor);
    }
    saveRuntimeState(state, db);
    return state;
  } finally {
    if (owned) {
      db.close();
    }
  }
}
