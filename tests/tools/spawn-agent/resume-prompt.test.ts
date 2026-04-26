import { describe, expect, it } from "bun:test";

import { buildSubagentResumePrompt } from "../../../src/tools/spawn-agent/resume-prompt";

const ERROR_TYPE = "网络错误";
const HINT = "先运行测试";
const BASE_PROMPT =
  "你之前的执行因 网络错误 中断。请检查你之前的进度,继续完成原任务。如果你认为已经完成,请输出最终结果;如果遇到阻塞,请明确说明阻塞点。";

describe("buildSubagentResumePrompt", () => {
  it("builds the stable resume template without a hint", () => {
    expect(buildSubagentResumePrompt({ errorType: ERROR_TYPE })).toBe(BASE_PROMPT);
  });

  it("appends the stable hint block when provided", () => {
    expect(buildSubagentResumePrompt({ errorType: ERROR_TYPE, hint: HINT })).toBe(
      `${BASE_PROMPT}\n\n额外提示: ${HINT}`,
    );
  });
});
