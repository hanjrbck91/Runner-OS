/**
 * Default production-neutral adapters for the Clock and IdGenerator ports.
 * No Node-only or framework APIs beyond the Web-standard crypto global
 * (available in Node >= 19 and browsers).
 */
import type { Clock, IdGenerator } from '../ports/index.js';
import { DEFAULT_TIMEZONE } from '../domain/time.js';

export class SystemClock implements Clock {
  constructor(private readonly tz: string = DEFAULT_TIMEZONE) {}
  now(): Date { return new Date(); }
  timezone(): string { return this.tz; }
}

/**
 * UUID id strategy. Decision: UUID v4 via the Web Crypto `randomUUID`.
 * Portable (browser + Node), globally unique, not row/position dependent,
 * multi-user safe. In M07-C the database column defaults to gen_random_uuid();
 * IDs are opaque, so switching to UUID v7 later needs no domain change.
 */
export class UuidIdGenerator implements IdGenerator {
  newId(): string {
    return globalThis.crypto.randomUUID();
  }
}
