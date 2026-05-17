import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin } from "@/index";
import { stopSharedServer } from "@/octto/session/server";

const REPO_ROOT = join(__dirname, "..", "..");
const AGENTS_DIR = join(REPO_ROOT, "src", "agents");
const TEMP_PREFIX = "micode-prompt-tool-contract-";
const TEST_SESSION_ID = "prompt-tool-contract-session";

// PROMPT_CALLABLE_ALLOWLIST contains legitimate callables that are not micode
// plugin-registered tools: OpenCode built-ins plus explicitly external MCP tools.
const PROMPT_CALLABLE_ALLOWLIST = new Set([
  "Task", // OpenCode built-in subagent dispatcher.
  "question", // OpenCode built-in structured question tool.
  "autoinfo_send_qq_notification", // External MCP notification tool used by prompts.
  "autoinfo_remote_ask", // External MCP remote ask tool named only for policy boundaries.
]);

interface PromptCallableReference {
  readonly name: string;
  readonly line: number;
  readonly context: string;
}

let tempRoot: string | undefined;

function createCtx(directory: string): PluginInput {
  return {
    directory,
    client: {
      session: {
        create: async () => ({ data: { id: TEST_SESSION_ID } }),
        prompt: async () => ({ data: { parts: [] } }),
        delete: async () => ({ data: { id: TEST_SESSION_ID } }),
        messages: async () => ({ data: [] }),
        abort: async () => ({ data: { id: TEST_SESSION_ID } }),
        summarize: async () => ({ data: { id: TEST_SESSION_ID } }),
      },
      tui: {
        showToast: async () => undefined,
      },
    },
  } as unknown as PluginInput;
}

function stripFencedCode(input: string): string {
  return input.replace(/```[\s\S]*?```/gu, (match) => "\n".repeat(match.split("\n").length - 1));
}

function isAgentSourceFile(path: string): boolean {
  if (!path.endsWith(".ts")) return false;

  const relativePath = relative(AGENTS_DIR, path).split(sep).join("/");
  return !relativePath.startsWith("context-capsule/");
}

function listAgentSourceFiles(directory = AGENTS_DIR): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listAgentSourceFiles(path));
      continue;
    }

    if (isAgentSourceFile(path)) files.push(path);
  }

  return files.sort();
}

function hasImperativeContext(before: string): boolean {
  return /(?:\b(?:call|invoke|use|via)\b|调用)/iu.test(before);
}

function looksLikeCallableIdentifier(name: string, context: string): boolean {
  if (name.includes("_")) return true;
  if (/[a-z][A-Z]/u.test(name)) return true;
  if (/^[A-Z]/u.test(name)) return true;
  return /\btools?\b|工具|callable/iu.test(context);
}

function lineNumberAt(input: string, index: number): number {
  return input.slice(0, index).split("\n").length;
}

function lineContextAt(input: string, index: number): string {
  const lineStart = input.lastIndexOf("\n", index) + 1;
  const nextLine = input.indexOf("\n", index);
  const lineEnd = nextLine === -1 ? input.length : nextLine;
  return input.slice(lineStart, lineEnd).trim();
}

function extractPromptCallables(source: string): PromptCallableReference[] {
  const stripped = stripFencedCode(source);
  const references: PromptCallableReference[] = [];
  const pattern = /`([A-Za-z_][A-Za-z0-9_.-]*)`/gu;

  for (const match of stripped.matchAll(pattern)) {
    const index = match.index ?? 0;
    const lineStart = stripped.lastIndexOf("\n", index) + 1;
    const lineEndIndex = stripped.indexOf("\n", index);
    const lineEnd = lineEndIndex === -1 ? stripped.length : lineEndIndex;
    const before = stripped.slice(Math.max(lineStart, index - 120), index);
    const after = stripped.slice(index + match[0].length, Math.min(lineEnd, index + match[0].length + 80));
    const context = `${before}${match[0]}${after}`;

    if (!hasImperativeContext(before)) continue;
    if (!looksLikeCallableIdentifier(match[1], context)) continue;

    references.push({ name: match[1], line: lineNumberAt(stripped, index), context: lineContextAt(stripped, index) });
  }

  return references;
}

async function getRegisteredPluginTools(): Promise<Set<string>> {
  tempRoot = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
  mkdirSync(tempRoot, { recursive: true });

  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

  try {
    const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
    return new Set(Object.keys(plugin.tool ?? {}));
  } finally {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  }
}

describe("prompt tool contract", () => {
  afterEach(async () => {
    await stopSharedServer();
    if (!tempRoot) return;
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it("extracts only imperative backticked callable names", () => {
    expect(extractPromptCallables("For historical context, see `spawn_agent`."), "narrative mention").toEqual([]);

    expect(extractPromptCallables("Before dispatch, call `findReusableContextCapsule`."), "imperative call").toEqual([
      {
        name: "findReusableContextCapsule",
        line: 1,
        context: "Before dispatch, call `findReusableContextCapsule`.",
      },
    ]);
  });

  it("flags imperative callables that are neither registered plugin tools nor explicit allowlist entries", async () => {
    const registeredTools = await getRegisteredPluginTools();
    const unknowns = extractPromptCallables("call `findReusableContextCapsule` before dispatch.").filter(
      (reference) => !registeredTools.has(reference.name) && !PROMPT_CALLABLE_ALLOWLIST.has(reference.name),
    );

    expect(unknowns.map((reference) => reference.name)).toEqual(["findReusableContextCapsule"]);
  });

  it("keeps imperative backticked callables in agent prompts aligned with registered tools", async () => {
    const registeredTools = await getRegisteredPluginTools();
    const violations = listAgentSourceFiles()
      .flatMap((file) =>
        extractPromptCallables(readFileSync(file, "utf8")).map((reference) => ({
          file: relative(REPO_ROOT, file),
          ...reference,
        })),
      )
      .filter((reference) => !registeredTools.has(reference.name) && !PROMPT_CALLABLE_ALLOWLIST.has(reference.name));

    expect(
      violations.map((reference) => `${reference.file}:${reference.line} ${reference.name} — ${reference.context}`),
    ).toEqual([]);
  });
});
