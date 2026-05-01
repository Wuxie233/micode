import { describe, expect, it } from "bun:test";

import { createDedupeStore } from "@/notifications/dedupe";
import { createNoopSink, type NotificationSink } from "@/notifications/delivery";
import { createNotifier } from "@/notifications/notifier";
import { createPolicy } from "@/notifications/policy";
import { NOTIFICATION_STATUSES } from "@/notifications/types";

const baseConfig = {
  enabled: true,
  qqUserId: "445714414",
  qqGroupId: null as string | null,
  maxSummaryChars: 200,
  dedupeTtlMs: 60_000,
  dedupeMaxEntries: 100,
};

const captureWarns = async (run: () => Promise<void>): Promise<ReadonlyArray<unknown>> => {
  const originalWarn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await run();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
};

const captureLogs = async (run: () => Promise<void>): Promise<ReadonlyArray<unknown>> => {
  const originalLog = console.log;
  const logs: unknown[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    await run();
  } finally {
    console.log = originalLog;
  }
  return logs;
};

describe("createNotifier", () => {
  it("delivers a completed notification once per task", async () => {
    const sink = createNoopSink();
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const policy = createPolicy({ config: baseConfig, dedupe });
    const notifier = createNotifier({ config: baseConfig, sink, policy });

    const logs = await captureLogs(async () => {
      await notifier.notify({
        status: NOTIFICATION_STATUSES.COMPLETED,
        issueNumber: 16,
        title: "demo",
        summary: "done",
        reference: null,
      });
      await notifier.notify({
        status: NOTIFICATION_STATUSES.COMPLETED,
        issueNumber: 16,
        title: "demo",
        summary: "done",
        reference: null,
      });
    });

    expect(sink.deliveries.length).toBe(1);
    expect(logs.length).toBe(1);
  });

  it("never throws when the sink throws", async () => {
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const failingSink: NotificationSink = {
      deliver: async (_request, _message) => {
        throw new Error("explode");
      },
    };
    const notifier = createNotifier({
      config: baseConfig,
      sink: failingSink,
      policy: createPolicy({ config: baseConfig, dedupe }),
    });

    const warnings = await captureWarns(async () => {
      await expect(
        notifier.notify({
          status: NOTIFICATION_STATUSES.FAILED_STOP,
          issueNumber: 1,
          title: "x",
          summary: "y",
          reference: null,
        }),
      ).resolves.toBeUndefined();
    });
    expect(warnings.length).toBe(1);
  });

  it("skips delivery when policy reports disabled", async () => {
    const sink = createNoopSink();
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const config = { ...baseConfig, enabled: false };
    const notifier = createNotifier({ config, sink, policy: createPolicy({ config, dedupe }) });

    await notifier.notify({
      status: NOTIFICATION_STATUSES.COMPLETED,
      issueNumber: 1,
      title: "x",
      summary: "y",
      reference: null,
    });
    expect(sink.deliveries.length).toBe(0);
  });
});
