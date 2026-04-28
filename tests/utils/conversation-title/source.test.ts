import { describe, expect, it } from "bun:test";

import {
  compareConfidence,
  isLowInformationMessage,
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
