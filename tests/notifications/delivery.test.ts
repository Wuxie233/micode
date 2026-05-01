import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { createCourierSink, createNoopSink } from "@/notifications/delivery";
import { NOTIFICATION_STATUSES, type NotificationRequest } from "@/notifications/types";

const TARGET = { kind: "private", userId: "445714414" } as const;
const RENDERED_MESSAGE = "[completed] demo";
const RENDERED_REVIEW_MESSAGE = `${RENDERED_MESSAGE}\nReturn to OpenCode to review.`;
const NOOP_LOG = "[notifications] noop sink recorded completed for lifecycle:1:completed";
const COURIER_ERROR_LOG = "[notifications] courier delivery failed: courier offline";

const sampleRequest = (): NotificationRequest => ({
  key: "lifecycle:1:completed",
  status: NOTIFICATION_STATUSES.COMPLETED,
  title: "demo",
  summary: "done",
  reference: null,
  target: TARGET,
});

let consoleLogSpy: ReturnType<typeof spyOn>;
let consoleWarnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe("createNoopSink", () => {
  it("records every delivery without throwing", async () => {
    const sink = createNoopSink();
    await sink.deliver(sampleRequest(), RENDERED_REVIEW_MESSAGE);
    expect(sink.deliveries.length).toBe(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(NOOP_LOG);
  });
});

describe("createCourierSink", () => {
  it("invokes the injected courier with target and message", async () => {
    const calls: Array<{ target: NotificationRequest["target"]; message: string }> = [];
    const sink = createCourierSink({
      invoke: async (target, message) => {
        calls.push({ target, message });
      },
    });
    await sink.deliver(sampleRequest(), RENDERED_MESSAGE);
    expect(calls).toEqual([{ target: TARGET, message: RENDERED_MESSAGE }]);
  });

  it("absorbs courier failures so workflow callers never throw", async () => {
    const sink = createCourierSink({
      invoke: async () => {
        throw new Error("courier offline");
      },
    });
    await expect(sink.deliver(sampleRequest(), RENDERED_MESSAGE)).resolves.toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(COURIER_ERROR_LOG);
  });
});
