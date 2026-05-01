import { describe, expect, it } from "bun:test";

import {
  NOTIFICATION_STATUSES,
  type NotificationRequest,
  type NotificationStatus,
  type NotificationTarget,
} from "@/notifications/types";

describe("notification types", () => {
  it("exposes the three terminal statuses", () => {
    expect(NOTIFICATION_STATUSES.COMPLETED).toBe("completed");
    expect(NOTIFICATION_STATUSES.BLOCKED).toBe("blocked");
    expect(NOTIFICATION_STATUSES.FAILED_STOP).toBe("failed_stop");
  });

  it("derives the status union from the constant map", () => {
    const statuses: readonly NotificationStatus[] = [
      NOTIFICATION_STATUSES.COMPLETED,
      NOTIFICATION_STATUSES.BLOCKED,
      NOTIFICATION_STATUSES.FAILED_STOP,
    ];
    expect(statuses.length).toBe(3);
  });

  it("accepts a fully-formed notification request", () => {
    const target: NotificationTarget = { kind: "private", userId: "445714414" };
    const request: NotificationRequest = {
      key: "lifecycle:16:completed",
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: "demo",
      summary: "done",
      reference: "https://example.com/issues/16",
      target,
    };
    expect(request.target.kind).toBe("private");
  });
});
