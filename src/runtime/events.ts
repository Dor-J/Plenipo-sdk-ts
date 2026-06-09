/** Typed runtime events for Agent Runtime v0.1. */

export type AgentEventType =
  | 'connect'
  | 'disconnect'
  | 'message'
  | 'delivery_receipt'
  | 'error';

export interface ConnectEvent {
  type: 'connect';
  did: string;
}

export interface DisconnectEvent {
  type: 'disconnect';
  reason: string;
}

export interface MessageEvent {
  type: 'message';
  envelopeId: string;
  senderDid: string;
  recipientDid: string;
  plaintext: string | null;
  createdAt: string | null;
}

export interface DeliveryReceiptEvent {
  type: 'delivery_receipt';
  envelopeId: string;
  senderDid: string | null;
  recipientDid: string | null;
  ciphertextBytes: number | null;
  billableKb: number | null;
  chargedTokens: number | null;
  balanceAfter: number | null;
  receivedAt: string | null;
  deliveredAt: string | null;
  recovered: boolean;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

export type AgentEvent =
  | ConnectEvent
  | DisconnectEvent
  | MessageEvent
  | DeliveryReceiptEvent
  | ErrorEvent;

/** Async queue for runtime events. */
export class EventQueue<T> {
  private readonly queue: T[] = [];
  private waiters: Array<(value: T) => void> = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.queue.push(item);
  }

  async next(): Promise<T> {
    const existing = this.queue.shift();
    if (existing !== undefined) {
      return existing;
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}
