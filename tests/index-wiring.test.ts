import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin } from "../src/index";
import { stopSharedServer } from "../src/octto/session/server";
import { config } from "../src/utils/config";

const PREFIX = "micode-index-wiring-";
const SESSION_ID = "plugin-boot-session";
const EMPTY_PORTAL_TOKEN = "";
const EXPECTED_TOOLS = [
  "lifecycle_start_request",
  "lifecycle_record_artifact",
  "lifecycle_commit",
  "lifecycle_finish",
  "resume_subagent",
] as const;
const TRACKED_KEYS = {
  PERSISTED_SESSIONS_DIR: "persistedSessionsDir",
  LIFECYCLE_DIR: "lifecycleDir",
  MAX_RESUMES_PER_SESSION: "maxResumesPerSession",
  FAILED_SESSION_TTL_HOURS: "failedSessionTtlHours",
  RESUME_SWEEP_INTERVAL_MS: "resumeSweepIntervalMs",
} as const;

const originals = {
  envPortalToken: process.env.OCTTO_PORTAL_TOKEN,
  portalToken: config.octto.portalToken,
  persistedSessionsDir: config.octto.persistedSessionsDir,
  lifecycleDir: config.lifecycle.lifecycleDir,
  maxResumesPerSession: config.subagent.maxResumesPerSession,
  failedSessionTtlHours: config.subagent.failedSessionTtlHours,
  resumeSweepIntervalMs: config.subagent.resumeSweepIntervalMs,
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
}

function restoreEnv(): void {
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

  process.env.OCTTO_PORTAL_TOKEN = EMPTY_PORTAL_TOKEN;
  restoreField(config.octto, "portalToken", EMPTY_PORTAL_TOKEN);
  trackRead(config.octto, TRACKED_KEYS.PERSISTED_SESSIONS_DIR, sessionsDir, reads);
  trackRead(config.lifecycle, TRACKED_KEYS.LIFECYCLE_DIR, lifecycleDir, reads);
  trackRead(config.subagent, TRACKED_KEYS.MAX_RESUMES_PER_SESSION, originals.maxResumesPerSession, reads);
  trackRead(config.subagent, TRACKED_KEYS.FAILED_SESSION_TTL_HOURS, originals.failedSessionTtlHours, reads);
  trackRead(config.subagent, TRACKED_KEYS.RESUME_SWEEP_INTERVAL_MS, originals.resumeSweepIntervalMs, reads);
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
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
