import { describe, expect, it } from "bun:test";

import { AGENT_ROLE_LABELS, agentRoleLabel } from "@/tools/spawn-agent/agent-roles";

describe("agent-roles", () => {
  it("returns Chinese label for known agent", () => {
    expect(agentRoleLabel("implementer-backend")).toBe("后端实现");
    expect(agentRoleLabel("implementer-frontend-ui")).toBe("前端UI实现");
    expect(agentRoleLabel("implementer-frontend-code")).toBe("前端代码实现");
    expect(agentRoleLabel("implementer-general")).toBe("通用实现");
    expect(agentRoleLabel("reviewer")).toBe("代码审查");
    expect(agentRoleLabel("planner")).toBe("规划");
    expect(agentRoleLabel("brainstormer")).toBe("方案探索");
    expect(agentRoleLabel("executor")).toBe("执行调度");
    expect(agentRoleLabel("commander")).toBe("总指挥");
    expect(agentRoleLabel("codebase-analyzer")).toBe("代码分析");
    expect(agentRoleLabel("codebase-locator")).toBe("代码定位");
    expect(agentRoleLabel("pattern-finder")).toBe("模式查找");
    expect(agentRoleLabel("critic")).toBe("对抗审查");
  });

  it("does not silently label the old implementer-frontend (must surface as raw name)", () => {
    // After the split, the old name should NOT be in the friendly-label map.
    // It still passes through as the raw name because the function falls back to the cleaned input.
    expect(agentRoleLabel("implementer-frontend")).toBe("implementer-frontend");
    expect(AGENT_ROLE_LABELS["implementer-frontend"]).toBeUndefined();
  });

  it("strips spawn-agent. technical prefix from unknown agent name", () => {
    expect(agentRoleLabel("spawn-agent.unknown-agent")).toBe("unknown-agent");
  });

  it("returns the original name for unknown agent without prefix", () => {
    expect(agentRoleLabel("custom-agent")).toBe("custom-agent");
  });

  it("returns generic fallback for empty or whitespace input", () => {
    expect(agentRoleLabel("")).toBe("子任务");
    expect(agentRoleLabel("   ")).toBe("子任务");
  });

  it("exposes the label map as readonly record", () => {
    expect(AGENT_ROLE_LABELS.reviewer).toBe("代码审查");
    expect(AGENT_ROLE_LABELS.critic).toBe("对抗审查");
    expect(AGENT_ROLE_LABELS["implementer-frontend-ui"]).toBe("前端UI实现");
    expect(AGENT_ROLE_LABELS["implementer-frontend-code"]).toBe("前端代码实现");
  });

  it("returns Chinese labels for the five specialist agents", () => {
    expect(agentRoleLabel("product-manager")).toBe("产品经理");
    expect(agentRoleLabel("software-architect")).toBe("软件架构师");
    expect(agentRoleLabel("ux-designer")).toBe("UX 设计师");
    expect(agentRoleLabel("architecture-quality-inspector")).toBe("架构质检");
    expect(agentRoleLabel("rubric-reviewer")).toBe("Rubric 评审");
  });

  it("exposes the five specialists in the readonly label map", () => {
    expect(AGENT_ROLE_LABELS["product-manager"]).toBe("产品经理");
    expect(AGENT_ROLE_LABELS["software-architect"]).toBe("软件架构师");
    expect(AGENT_ROLE_LABELS["ux-designer"]).toBe("UX 设计师");
    expect(AGENT_ROLE_LABELS["architecture-quality-inspector"]).toBe("架构质检");
    expect(AGENT_ROLE_LABELS["rubric-reviewer"]).toBe("Rubric 评审");
  });

  it("strips the spawn-agent. prefix from a specialist agent name", () => {
    expect(agentRoleLabel("spawn-agent.product-manager")).toBe("产品经理");
    expect(agentRoleLabel("spawn-agent.rubric-reviewer")).toBe("Rubric 评审");
  });

  it("strips the spawn-agent. prefix from the new frontend variants", () => {
    expect(agentRoleLabel("spawn-agent.implementer-frontend-ui")).toBe("前端UI实现");
    expect(agentRoleLabel("spawn-agent.implementer-frontend-code")).toBe("前端代码实现");
  });
});
