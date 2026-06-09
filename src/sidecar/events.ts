import type { RuntimeStore, SidecarEventRecord } from '../runtime/store.js';
import { sidecarEventToApiDict } from './models.js';
import { readSidecarStoreKey, SidecarStoreKeyError } from './inboxCrypto.js';

/** SQLite-backed durable event service with long-poll support. */
export class DurableEventService {
  private readonly store: RuntimeStore;
  private waiters: Array<() => void> = [];

  constructor(store: RuntimeStore) {
    this.store = store;
  }

  /** Wakes long-poll waiters after a new durable event is persisted. */
  notify(): void {
    for (const wake of this.waiters.splice(0)) {
      wake();
    }
  }

  async waitForEvents(options: {
    afterId: number;
    timeoutMs: number;
    limit: number;
    includePlaintext?: boolean;
  }): Promise<{ events: Record<string, unknown>[]; nextAfterId: number }> {
    const includePlaintext = options.includePlaintext !== false;
    const deadline = Date.now() + options.timeoutMs;

    while (true) {
      const rows = this.store.listSidecarEvents(options.afterId, options.limit);
      if (rows.length) {
        const events = this.rowsToApi(rows, includePlaintext);
        return { events, nextAfterId: rows[rows.length - 1]?.id ?? options.afterId };
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { events: [], nextAfterId: options.afterId };
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  listEventsAfter(options: {
    afterId: number;
    limit: number;
    includePlaintext?: boolean;
  }): { events: Record<string, unknown>[]; nextAfterId: number } {
    const includePlaintext = options.includePlaintext !== false;
    const rows = this.store.listSidecarEvents(options.afterId, options.limit);
    if (!rows.length) {
      return { events: [], nextAfterId: options.afterId };
    }
    return {
      events: this.rowsToApi(rows, includePlaintext),
      nextAfterId: rows[rows.length - 1]?.id ?? options.afterId,
    };
  }

  private rowsToApi(rows: SidecarEventRecord[], includePlaintext: boolean): Record<string, unknown>[] {
    let storeKey: Uint8Array | null = null;
    if (includePlaintext && rows.some((row) => row.eventType === 'message')) {
      if (this.store.countInboxMessages() > 0) {
        storeKey = readSidecarStoreKey();
        if (!storeKey) {
          throw new SidecarStoreKeyError(
            'sidecar store key missing; cannot decrypt encrypted local inbox',
          );
        }
      }
    }
    return rows.map((row) =>
      sidecarEventToApiDict(row, {
        store: this.store,
        includePlaintext,
        storeKey,
      }),
    );
  }
}

/** Backward-compatible alias. */
export const EventBuffer = DurableEventService;

/** Wakes durable event waiters when runtime emits public events. */
export async function consumeRuntimeEvents(
  events: AsyncGenerator<{ type: string }>,
  buffer: DurableEventService,
): Promise<void> {
  for await (const event of events) {
    if (event.type === 'message' || event.type === 'delivery_receipt') {
      buffer.notify();
    }
  }
}
