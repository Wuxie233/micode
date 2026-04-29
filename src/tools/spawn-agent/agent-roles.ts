const SPAWN_AGENT_PREFIX = "spawn-agent.";
const GENERIC_FALLBACK = "子任务";

export const AGENT_ROLE_LABELS: Readonly<Record<string, string>> = {
  "implementer-backend": "后端实现",
  "implementer-frontend": "前端实现",
  "implementer-general": "通用实现",
  reviewer: "代码审查",
  planner: "规划",
  brainstormer: "方案探索",
  executor: "执行调度",
  commander: "总指挥",
  "codebase-analyzer": "代码分析",
  "codebase-locator": "代码定位",
  "pattern-finder": "模式查找",
};

function stripSpawnAgentPrefix(value: string): string {
  return value.startsWith(SPAWN_AGENT_PREFIX) ? value.slice(SPAWN_AGENT_PREFIX.length) : value;
}

export function agentRoleLabel(agent: string): string {
  const trimmed = agent.trim();
  if (trimmed.length === 0) return GENERIC_FALLBACK;

  const cleaned = stripSpawnAgentPrefix(trimmed);
  if (cleaned.length === 0) return GENERIC_FALLBACK;

  return AGENT_ROLE_LABELS[cleaned] ?? cleaned;
}
