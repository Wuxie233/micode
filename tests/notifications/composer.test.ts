import { describe, expect, it } from "bun:test";

import { composeMessage } from "@/notifications/composer";
import { NOTIFICATION_STATUSES } from "@/notifications/types";

const SECRET = "ghp_AAAAAAAAAAAAAAAAAAAAAAAAA";
const REDACTED_PLACEHOLDER = "[redacted]";

describe("composeMessage", () => {
  it("includes the status, sanitized title, and reference URL", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: "Add QQ notifications",
      summary: "all batches green",
      reference: "https://github.com/example/repo/issues/16",
      maxSummaryChars: 200,
    });
    expect(message).toContain("[completed]");
    expect(message).toContain("Add QQ notifications");
    expect(message).toContain("https://github.com/example/repo/issues/16");
  });

  it("falls back to a generic label when title is empty", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.BLOCKED,
      title: "",
      summary: "",
      reference: null,
      maxSummaryChars: 200,
    });
    expect(message).toContain("[blocked]");
    expect(message).toContain("micode task");
  });

  it("scrubs control characters and truncates the summary", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: "demo",
      summary: `${"x".repeat(500)}\u0001\u0002`,
      reference: null,
      maxSummaryChars: 50,
    });
    expect(message.length).toBeLessThan(500);
    expect(message).not.toContain("\u0001");
  });

  it("drops the summary entirely when it would contain a secret", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: "demo",
      summary: `leak ${SECRET} hello`,
      reference: null,
      maxSummaryChars: 200,
    });
    expect(message).not.toContain("ghp_");
    expect(message).toContain(REDACTED_PLACEHOLDER);
  });

  it("redacts a secret even when truncation hides the full token", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: "demo",
      summary: `${SECRET} hello`,
      reference: null,
      maxSummaryChars: 8,
    });
    expect(message).not.toContain("ghp_");
    expect(message).toContain(REDACTED_PLACEHOLDER);
  });

  it("redacts a secret-bearing title", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: `deploy ${SECRET}`,
      summary: "done",
      reference: null,
      maxSummaryChars: 200,
    });
    expect(message).not.toContain(SECRET);
    expect(message).toContain(REDACTED_PLACEHOLDER);
  });

  it("redacts a secret-bearing reference", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: "demo",
      summary: "",
      reference: `https://example.com/callback?token=${SECRET}`,
      maxSummaryChars: 200,
    });
    expect(message).not.toContain(SECRET);
    expect(message).toContain(`${REDACTED_PLACEHOLDER}\nReturn to OpenCode`);
  });

  it("emits the standard review instruction at the end of every message", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.FAILED_STOP,
      title: "x",
      summary: "y",
      reference: null,
      maxSummaryChars: 200,
    });
    expect(message).toContain("Return to OpenCode");
  });
});
