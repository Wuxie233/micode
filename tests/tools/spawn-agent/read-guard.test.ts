import { describe, expect, it, mock } from "bun:test";

import { readAssistantText, readAssistantTextWithRetry, type SessionMessage } from "@/tools/spawn-agent/read-guard";

const NO_SLEEP = async (_ms: number): Promise<void> => {};

describe("readAssistantTextWithRetry", () => {
  it("returns immediately when firstOutput is non-empty (no re-reads)", async () => {
    const reread = mock(async () => "should not be called");
    const result = await readAssistantTextWithRetry("hello", reread, {
      maxExtraReads: 2,
      backoffMs: [10, 20],
      sleep: NO_SLEEP,
    });
    expect(result).toEqual({ output: "hello", extraReads: 0, exhausted: false });
    expect(reread).toHaveBeenCalledTimes(0);
  });

  it("treats whitespace-only firstOutput as empty and triggers re-reads", async () => {
    const reread = mock(async () => "recovered");
    const result = await readAssistantTextWithRetry("   \n\t  ", reread, {
      maxExtraReads: 2,
      backoffMs: [10, 20],
      sleep: NO_SLEEP,
    });
    expect(result.output).toBe("recovered");
    expect(result.extraReads).toBe(1);
    expect(result.exhausted).toBe(false);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it("returns first non-empty re-read and stops further re-reads", async () => {
    let calls = 0;
    const reread = mock(async () => {
      calls += 1;
      if (calls === 1) return "";
      if (calls === 2) return "found on second extra";
      return "should not be reached";
    });
    const result = await readAssistantTextWithRetry("", reread, {
      maxExtraReads: 3,
      backoffMs: [10, 20, 30],
      sleep: NO_SLEEP,
    });
    expect(result.output).toBe("found on second extra");
    expect(result.extraReads).toBe(2);
    expect(result.exhausted).toBe(false);
    expect(reread).toHaveBeenCalledTimes(2);
  });

  it("marks exhausted when all re-reads return empty", async () => {
    const reread = mock(async () => "");
    const result = await readAssistantTextWithRetry("", reread, {
      maxExtraReads: 2,
      backoffMs: [10, 20],
      sleep: NO_SLEEP,
    });
    expect(result).toEqual({ output: "", extraReads: 2, exhausted: true });
    expect(reread).toHaveBeenCalledTimes(2);
  });

  it("returns immediately exhausted when maxExtraReads is 0", async () => {
    const reread = mock(async () => "never called");
    const result = await readAssistantTextWithRetry("", reread, {
      maxExtraReads: 0,
      backoffMs: [],
      sleep: NO_SLEEP,
    });
    expect(result).toEqual({ output: "", extraReads: 0, exhausted: true });
    expect(reread).toHaveBeenCalledTimes(0);
  });

  it("propagates errors from reread without swallowing them", async () => {
    const boom = new Error("messages API exploded");
    const reread = mock(async () => {
      throw boom;
    });
    await expect(
      readAssistantTextWithRetry("", reread, {
        maxExtraReads: 2,
        backoffMs: [10, 20],
        sleep: NO_SLEEP,
      }),
    ).rejects.toBe(boom);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it("uses the last backoffMs entry when maxExtraReads exceeds the array length", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
    };
    const reread = mock(async () => "");
    await readAssistantTextWithRetry("", reread, {
      maxExtraReads: 4,
      backoffMs: [50, 100],
      sleep,
    });
    expect(sleeps).toEqual([50, 100, 100, 100]);
  });

  it("sleeps before each re-read using backoffMs in order", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
    };
    const reread = mock(async () => "");
    await readAssistantTextWithRetry("", reread, {
      maxExtraReads: 2,
      backoffMs: [200, 500],
      sleep,
    });
    expect(sleeps).toEqual([200, 500]);
  });
});

describe("readAssistantText (reverse-scan)", () => {
  it("returns text from the only assistant text part", () => {
    const messages: SessionMessage[] = [{ info: { role: "assistant" }, parts: [{ type: "text", text: "hello" }] }];

    expect(readAssistantText(messages)).toBe("hello");
  });

  it("skips terminal tool-call-only assistant message and returns prior text", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "substantive output" }] },
      { info: { role: "assistant" }, parts: [{ type: "tool_call" }] },
    ];

    expect(readAssistantText(messages)).toBe("substantive output");
  });

  it("skips terminal whitespace-only assistant message and returns prior text", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "actual output" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "  \n\t  " }] },
    ];

    expect(readAssistantText(messages)).toBe("actual output");
  });

  it("skips multiple trailing non-text assistant messages", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "kept output" }] },
      { info: { role: "assistant" }, parts: [{ type: "tool_call" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "   " }] },
      { info: { role: "assistant" }, parts: [{ type: "summary" }] },
    ];

    expect(readAssistantText(messages)).toBe("kept output");
  });

  it("returns empty string when every assistant message is non-text", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "tool_call" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "   " }] },
    ];

    expect(readAssistantText(messages)).toBe("");
  });

  it("returns empty string when there are no assistant messages", () => {
    const messages: SessionMessage[] = [{ info: { role: "user" }, parts: [{ type: "text", text: "prompt" }] }];

    expect(readAssistantText(messages)).toBe("");
  });

  it("joins multiple text parts in the chosen assistant message with newlines", () => {
    const messages: SessionMessage[] = [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "line one" }, { type: "tool_call" }, { type: "text", text: "line two" }],
      },
    ];

    expect(readAssistantText(messages)).toBe("line one\nline two");
  });

  it("ignores trailing non-assistant messages while reverse scanning", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "assistant output" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "follow-up" }] },
    ];

    expect(readAssistantText(messages)).toBe("assistant output");
  });

  it("skips assistant messages with missing parts array", () => {
    const messages: SessionMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "previous output" }] },
      { info: { role: "assistant" } },
    ];

    expect(readAssistantText(messages)).toBe("previous output");
  });
});
