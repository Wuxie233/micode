import { describe, expect, it } from "bun:test";

import { createDedupeStore } from "@/notifications/dedupe";
import { NOTIFICATION_STATUSES } from "@/notifications/types";

describe("dedupe store", () => {
  it("returns false on first observation of a key", () => {
    const store = createDedupeStore({ ttlMs: 60_000, maxEntries: 10 });
    expect(store.shouldSuppress("lifecycle:1:completed", NOTIFICATION_STATUSES.COMPLETED)).toBe(false);
    store.record("lifecycle:1:completed", NOTIFICATION_STATUSES.COMPLETED);
  });

  it("returns true when the same key is observed again within TTL", () => {
    const store = createDedupeStore({ ttlMs: 60_000, maxEntries: 10 });
    store.record("lifecycle:1:completed", NOTIFICATION_STATUSES.COMPLETED);
    expect(store.shouldSuppress("lifecycle:1:completed", NOTIFICATION_STATUSES.COMPLETED)).toBe(true);
  });

  it("permits a later completed status after an earlier blocked status for the same task", () => {
    const store = createDedupeStore({ ttlMs: 60_000, maxEntries: 10 });
    store.record("lifecycle:1:blocked", NOTIFICATION_STATUSES.BLOCKED);
    expect(store.shouldSuppress("lifecycle:1:completed", NOTIFICATION_STATUSES.COMPLETED)).toBe(false);
  });

  it("expires entries after the TTL elapses", () => {
    let now = 1000;
    const store = createDedupeStore({ ttlMs: 50, maxEntries: 10, clock: () => now });
    store.record("k", NOTIFICATION_STATUSES.COMPLETED);
    now += 100;
    expect(store.shouldSuppress("k", NOTIFICATION_STATUSES.COMPLETED)).toBe(false);
  });

  it("evicts the oldest entry once maxEntries is exceeded", () => {
    let now = 0;
    const store = createDedupeStore({ ttlMs: 60_000, maxEntries: 2, clock: () => now });
    store.record("a", NOTIFICATION_STATUSES.COMPLETED);
    now += 1;
    store.record("b", NOTIFICATION_STATUSES.COMPLETED);
    now += 1;
    store.record("c", NOTIFICATION_STATUSES.COMPLETED);
    expect(store.shouldSuppress("a", NOTIFICATION_STATUSES.COMPLETED)).toBe(false);
    expect(store.shouldSuppress("b", NOTIFICATION_STATUSES.COMPLETED)).toBe(true);
    expect(store.shouldSuppress("c", NOTIFICATION_STATUSES.COMPLETED)).toBe(true);
  });
});
