import { describe, expect, it } from "bun:test";

import {
  compareConfidence,
  isLowInformationMessage,
  isToolLikeTopic,
  LOW_INFO_PATTERNS,
  TITLE_SOURCE,
  TITLE_SOURCE_CONFIDENCE,
} from "@/utils/conversation-title/source";

const LOW_INFORMATION_MESSAGES = [
  "重启了",
  "什么",
  "继续",
  "接着",
  "OK?",
  "OkAy。",
  "好了",
  "好的",
  "收到",
  "嗯",
  "行",
  "DONE",
  "这是符合预期吗?",
  "这符合预期吗。",
  "WHAT DID WE DO SO FAR?",
  "怎么样",
  "然后呢",
  "NeXt?",
  "继续做",
  "继续吧",
] as const;

const TOOL_NAMES = [
  "spawn-agent",
  "spawn_agent",
  "implementer-frontend",
  "implementer-backend",
  "implementer-general",
  "executor",
  "reviewer",
  "codebase-locator",
  "codebase-analyzer",
  "pattern-finder",
  "planner",
  "brainstormer",
  "octto",
  "commander",
] as const;

const PROCESS_PHRASES = [
  "Create implementation plan",
  "Execute implementation plan",
  "Creating implementation plan",
  "Running executor",
  "Start executor",
  "Start implementer",
] as const;

describe("conversation title source", () => {
  it("exposes confidence values for every title source", () => {
    expect(TITLE_SOURCE_CONFIDENCE[TITLE_SOURCE.LIFECYCLE_ISSUE]).toBe(100);
    expect(TITLE_SOURCE_CONFIDENCE[TITLE_SOURCE.LIFECYCLE_FINISH]).toBe(95);
    expect(TITLE_SOURCE_CONFIDENCE[TITLE_SOURCE.PLAN_PATH]).toBe(70);
    expect(TITLE_SOURCE_CONFIDENCE[TITLE_SOURCE.DESIGN_PATH]).toBe(65);
    expect(TITLE_SOURCE_CONFIDENCE[TITLE_SOURCE.COMMIT_TITLE]).toBe(50);
    expect(TITLE_SOURCE_CONFIDENCE[TITLE_SOURCE.USER_MESSAGE]).toBe(30);
  });

  it("recognizes low-information blacklist messages after normalization", () => {
    for (const message of LOW_INFORMATION_MESSAGES) {
      expect(isLowInformationMessage(message)).toBe(true);
    }
  });

  it("exports the normalized low-information pattern set", () => {
    expect(LOW_INFO_PATTERNS.has("继续")).toBe(true);
    expect(LOW_INFO_PATTERNS.has("what did we do so far")).toBe(true);
  });

  it("does not treat a meaningful feature request as low information", () => {
    expect(isLowInformationMessage("想给 octto 加一个新功能")).toBe(false);
  });

  it("does not treat short Chinese task messages as low information", () => {
    expect(isLowInformationMessage("登录")).toBe(false);
    expect(isLowInformationMessage("改UI")).toBe(false);
  });

  it("treats very short normalized unicode messages as low information", () => {
    expect(isLowInformationMessage("什么")).toBe(true);
  });

  it("compares source confidence with positive values for stronger sources", () => {
    expect(compareConfidence(TITLE_SOURCE.LIFECYCLE_ISSUE, TITLE_SOURCE.USER_MESSAGE)).toBeGreaterThan(0);
  });
});

describe("conversation title source tool and agent low-info expansion", () => {
  it("treats every tool and agent name as low information", () => {
    for (const name of TOOL_NAMES) {
      expect(isLowInformationMessage(name)).toBe(true);
    }
  });

  it("treats process-phrase placeholders as low information", () => {
    for (const phrase of PROCESS_PHRASES) {
      expect(isLowInformationMessage(phrase)).toBe(true);
    }
  });

  it("normalizes case for tool and agent low-info patterns", () => {
    expect(isLowInformationMessage("EXECUTOR")).toBe(true);
    expect(isLowInformationMessage(" Implementer-Backend ")).toBe(true);
  });

  it("isToolLikeTopic flags exact tool and agent names", () => {
    for (const name of TOOL_NAMES) {
      expect(isToolLikeTopic(name)).toBe(true);
    }
  });

  it("isToolLikeTopic returns false for genuine Chinese requirement topics", () => {
    expect(isToolLikeTopic("优化主会话标题生成")).toBe(false);
    expect(isToolLikeTopic("自动改名")).toBe(false);
    expect(isToolLikeTopic("中文对话名字")).toBe(false);
  });

  it("isToolLikeTopic returns false for short Chinese task names", () => {
    expect(isToolLikeTopic("登录")).toBe(false);
    expect(isToolLikeTopic("改UI")).toBe(false);
  });

  it("LOW_INFO_PATTERNS exposes the expanded set", () => {
    expect(LOW_INFO_PATTERNS.has("executor")).toBe(true);
    expect(LOW_INFO_PATTERNS.has("create implementation plan")).toBe(true);
  });

  it("preserves existing low-info behavior", () => {
    expect(isLowInformationMessage("继续")).toBe(true);
    expect(isLowInformationMessage("想给 octto 加一个新功能")).toBe(false);
    expect(TITLE_SOURCE_CONFIDENCE[TITLE_SOURCE.LIFECYCLE_ISSUE]).toBe(100);
    expect(compareConfidence(TITLE_SOURCE.LIFECYCLE_ISSUE, TITLE_SOURCE.USER_MESSAGE)).toBeGreaterThan(0);
  });
});
