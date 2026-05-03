import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { createJournalStore } from "@/lifecycle/journal/store";
import { createLeaseStore } from "@/lifecycle/lease/store";
import { OpenCodeConfigPlugin } from "../src/index";
import { stopSharedServer } from "../src/octto/session/server";
import { config } from "../src/utils/config";

const PREFIX = "micode-index-wiring-";
const SESSION_ID = "plugin-boot-session";
const EMPTY_PORTAL_TOKEN = "";
const EXISTING_TOOLS = [
  "ast_grep_search",
  "ast_grep_replace",
  "btca_ask",
  "look_at",
  "artifact_search",
  "milestone_artifact_search",
  "spawn_agent",
  "batch_read",
  "mindmodel_lookup",
  "lifecycle_start_request",
  "lifecycle_record_artifact",
  "lifecycle_commit",
  "lifecycle_finish",
  "resume_subagent",
] as const;
const PROJECT_MEMORY_TOOLS = [
  "project_memory_lookup",
  "project_memory_promote",
  "project_memory_health",
  "project_memory_forget",
] as const;
const EXPECTED_TOOLS = [...EXISTING_TOOLS, ...PROJECT_MEMORY_TOOLS] as const;
const TRACKED_KEYS = {
  PERSISTED_SESSIONS_DIR: "persistedSessionsDir",
  LIFECYCLE_DIR: "lifecycleDir",
  MAX_RESUMES_PER_SESSION: "maxResumesPerSession",
  FAILED_SESSION_TTL_HOURS: "failedSessionTtlHours",
  RESUME_SWEEP_INTERVAL_MS: "resumeSweepIntervalMs",
  NOTIFICATIONS_ENABLED: "enabled",
  NOTIFICATIONS_QQ_USER_ID: "qqUserId",
  NOTIFICATIONS_QQ_GROUP_ID: "qqGroupId",
  NOTIFICATIONS_MAX_SUMMARY_CHARS: "maxSummaryChars",
  NOTIFICATIONS_DEDUPE_TTL_MS: "dedupeTtlMs",
  NOTIFICATIONS_DEDUPE_MAX_ENTRIES: "dedupeMaxEntries",
} as const;

const originals = {
  envHome: process.env.HOME,
  envPortalToken: process.env.OCTTO_PORTAL_TOKEN,
  portalToken: config.octto.portalToken,
  persistedSessionsDir: config.octto.persistedSessionsDir,
  lifecycleDir: config.lifecycle.lifecycleDir,
  maxResumesPerSession: config.subagent.maxResumesPerSession,
  failedSessionTtlHours: config.subagent.failedSessionTtlHours,
  resumeSweepIntervalMs: config.subagent.resumeSweepIntervalMs,
  notificationsEnabled: config.notifications.enabled,
  notificationsQqUserId: config.notifications.qqUserId,
  notificationsQqGroupId: config.notifications.qqGroupId,
  notificationsMaxSummaryChars: config.notifications.maxSummaryChars,
  notificationsDedupeTtlMs: config.notifications.dedupeTtlMs,
  notificationsDedupeMaxEntries: config.notifications.dedupeMaxEntries,
};

let tempRoot: string | undefined;

function restoreField(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    value,
    writable: true,
  });
}

function trackRead(target: object, key: string, value: unknown, reads: string[]): void {
  Object.defineProperty(target, key, {
    configurable: true,
    get: () => {
      reads.push(key);
      return value;
    },
  });
}

function restoreConfig(): void {
  restoreField(config.octto, TRACKED_KEYS.PERSISTED_SESSIONS_DIR, originals.persistedSessionsDir);
  restoreField(config.octto, "portalToken", originals.portalToken);
  restoreField(config.lifecycle, TRACKED_KEYS.LIFECYCLE_DIR, originals.lifecycleDir);
  restoreField(config.subagent, TRACKED_KEYS.MAX_RESUMES_PER_SESSION, originals.maxResumesPerSession);
  restoreField(config.subagent, TRACKED_KEYS.FAILED_SESSION_TTL_HOURS, originals.failedSessionTtlHours);
  restoreField(config.subagent, TRACKED_KEYS.RESUME_SWEEP_INTERVAL_MS, originals.resumeSweepIntervalMs);
  restoreField(config.notifications, TRACKED_KEYS.NOTIFICATIONS_ENABLED, originals.notificationsEnabled);
  restoreField(config.notifications, TRACKED_KEYS.NOTIFICATIONS_QQ_USER_ID, originals.notificationsQqUserId);
  restoreField(config.notifications, TRACKED_KEYS.NOTIFICATIONS_QQ_GROUP_ID, originals.notificationsQqGroupId);
  restoreField(
    config.notifications,
    TRACKED_KEYS.NOTIFICATIONS_MAX_SUMMARY_CHARS,
    originals.notificationsMaxSummaryChars,
  );
  restoreField(config.notifications, TRACKED_KEYS.NOTIFICATIONS_DEDUPE_TTL_MS, originals.notificationsDedupeTtlMs);
  restoreField(
    config.notifications,
    TRACKED_KEYS.NOTIFICATIONS_DEDUPE_MAX_ENTRIES,
    originals.notificationsDedupeMaxEntries,
  );
}

function restoreEnv(): void {
  if (originals.envHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originals.envHome;
  }

  if (originals.envPortalToken === undefined) {
    delete process.env.OCTTO_PORTAL_TOKEN;
    return;
  }

  process.env.OCTTO_PORTAL_TOKEN = originals.envPortalToken;
}

function createCtx(directory: string): PluginInput {
  return {
    directory,
    client: {
      session: {
        create: async () => ({ data: { id: SESSION_ID } }),
        prompt: async () => ({ data: { parts: [] } }),
        delete: async () => ({ data: { id: SESSION_ID } }),
        messages: async () => ({ data: [] }),
        abort: async () => ({ data: { id: SESSION_ID } }),
        summarize: async () => ({ data: { id: SESSION_ID } }),
      },
      tui: {
        showToast: async () => undefined,
      },
    },
  } as unknown as PluginInput;
}

function trackWiringConfig(reads: string[]): void {
  const sessionsDir = join(tempRoot ?? tmpdir(), "sessions");
  const lifecycleDir = join(tempRoot ?? tmpdir(), "lifecycle");

  process.env.HOME = tempRoot ?? tmpdir();
  process.env.OCTTO_PORTAL_TOKEN = EMPTY_PORTAL_TOKEN;
  restoreField(config.octto, "portalToken", EMPTY_PORTAL_TOKEN);
  trackRead(config.octto, TRACKED_KEYS.PERSISTED_SESSIONS_DIR, sessionsDir, reads);
  trackRead(config.lifecycle, TRACKED_KEYS.LIFECYCLE_DIR, lifecycleDir, reads);
  trackRead(config.subagent, TRACKED_KEYS.MAX_RESUMES_PER_SESSION, originals.maxResumesPerSession, reads);
  trackRead(config.subagent, TRACKED_KEYS.FAILED_SESSION_TTL_HOURS, originals.failedSessionTtlHours, reads);
  trackRead(config.subagent, TRACKED_KEYS.RESUME_SWEEP_INTERVAL_MS, originals.resumeSweepIntervalMs, reads);
  trackRead(config.notifications, TRACKED_KEYS.NOTIFICATIONS_ENABLED, originals.notificationsEnabled, reads);
  trackRead(config.notifications, TRACKED_KEYS.NOTIFICATIONS_QQ_USER_ID, originals.notificationsQqUserId, reads);
  trackRead(config.notifications, TRACKED_KEYS.NOTIFICATIONS_QQ_GROUP_ID, originals.notificationsQqGroupId, reads);
  trackRead(
    config.notifications,
    TRACKED_KEYS.NOTIFICATIONS_MAX_SUMMARY_CHARS,
    originals.notificationsMaxSummaryChars,
    reads,
  );
  trackRead(config.notifications, TRACKED_KEYS.NOTIFICATIONS_DEDUPE_TTL_MS, originals.notificationsDedupeTtlMs, reads);
  trackRead(
    config.notifications,
    TRACKED_KEYS.NOTIFICATIONS_DEDUPE_MAX_ENTRIES,
    originals.notificationsDedupeMaxEntries,
    reads,
  );
}

function writeMicodeConfig(directory: string, content: string): void {
  const configDir = join(directory, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "micode.json"), content);
}

interface PluginCommand {
  readonly agent?: string;
  readonly template?: string;
}

interface PluginConfigStub {
  permission?: Record<string, unknown>;
  agent?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  command?: Record<string, PluginCommand>;
}

async function applyPluginConfig(plugin: Awaited<ReturnType<typeof OpenCodeConfigPlugin>>): Promise<PluginConfigStub> {
  const pluginConfig: PluginConfigStub = { permission: {}, agent: {}, mcp: {}, command: {} };
  await plugin.config?.(pluginConfig as Parameters<NonNullable<typeof plugin.config>>[0]);
  return pluginConfig;
}

describe("OpenCodeConfigPlugin issue workflow wiring", () => {
  afterEach(async () => {
    await stopSharedServer();
    restoreConfig();
    restoreEnv();
    if (!tempRoot) return;
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it("boots with persistence, lifecycle, and resume tools wired from config", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const reads: string[] = [];
    trackWiringConfig(reads);
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
      const tools = Object.keys(plugin.tool ?? {});

      for (const tool of EXPECTED_TOOLS) {
        expect(tools).toContain(tool);
      }

      expect(config.octto.portalToken).toBe(EMPTY_PORTAL_TOKEN);
      expect(reads).toContain(TRACKED_KEYS.PERSISTED_SESSIONS_DIR);
      expect(reads).toContain(TRACKED_KEYS.LIFECYCLE_DIR);
      expect(reads).toContain(TRACKED_KEYS.MAX_RESUMES_PER_SESSION);
      expect(reads).toContain(TRACKED_KEYS.FAILED_SESSION_TTL_HOURS);
      expect(reads).toContain(TRACKED_KEYS.RESUME_SWEEP_INTERVAL_MS);
      expect(reads).toContain(TRACKED_KEYS.NOTIFICATIONS_ENABLED);
      expect(reads).toContain(TRACKED_KEYS.NOTIFICATIONS_QQ_USER_ID);
      expect(reads).toContain(TRACKED_KEYS.NOTIFICATIONS_QQ_GROUP_ID);
      expect(reads).toContain(TRACKED_KEYS.NOTIFICATIONS_MAX_SUMMARY_CHARS);
      expect(reads).toContain(TRACKED_KEYS.NOTIFICATIONS_DEDUPE_TTL_MS);
      expect(reads).toContain(TRACKED_KEYS.NOTIFICATIONS_DEDUPE_MAX_ENTRIES);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("does not register the legacy /skills plugin command", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const reads: string[] = [];
    trackWiringConfig(reads);
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
      const pluginConfig = await applyPluginConfig(plugin);

      expect(pluginConfig.command?.skills).toBeUndefined();
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("does not inject procedure context when skill evolution is not enabled", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const reads: string[] = [];
    trackWiringConfig(reads);
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
      const output = { system: "" };

      await plugin["chat.params"]?.({ sessionID: SESSION_ID }, output);

      expect(output.system).not.toContain("procedure-context");
      expect(output.system).toBe("");
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("does not inject procedure context when skill evolution is explicitly disabled", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const reads: string[] = [];
    trackWiringConfig(reads);
    writeMicodeConfig(tempRoot, '{ "features": { "skillEvolution": false } }');
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
      const output = { system: "" };

      await plugin["chat.params"]?.({ sessionID: SESSION_ID }, output);

      expect(output.system).not.toContain("procedure-context");
      expect(output.system).toBe("");
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe("notifications wiring", () => {
  it("imports OpenCodeConfigPlugin from the plugin entrypoint", async () => {
    const mod = await import("@/index");
    expect(typeof mod.OpenCodeConfigPlugin).toBe("function");
  });
});

describe("plugin entrypoint exports lifecycle journal/lease wiring", () => {
  it("createJournalStore is callable with no options", () => {
    expect(typeof createJournalStore({}).append).toBe("function");
  });

  it("createLeaseStore is callable with no options", () => {
    expect(typeof createLeaseStore({}).acquire).toBe("function");
  });
});
