// src/tools/diagnostics.ts
//
// Optional diagnostic dump for tool arguments. We use this when OpenCode
// hands a shape into `execute` that we can't reconcile with our schema, so we
// can inspect what the dispatcher actually produced after its own transform
// pass. Never throw from here — diagnostics must not break tools.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEBUG_FLAG_ENV = "MICODE_DEBUG_TOOL_ARGS";
const DEBUG_FLAG_VALUE = "1";
const DUMP_DIR_ENV = "MICODE_TOOL_ARG_DUMP_DIR";

function dumpDir(): string {
  return process.env[DUMP_DIR_ENV] ?? tmpdir();
}

function dumpPath(toolName: string): string {
  return join(dumpDir(), `micode-${toolName}-${process.pid}-${Date.now()}.json`);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({ _diagnostic: "stringify-failed", typeof: typeof value });
  }
}

export function dumpRawArgs(toolName: string, args: unknown): string | null {
  const path = dumpPath(toolName);
  try {
    writeFileSync(path, safeStringify(args), "utf8");
    return path;
  } catch {
    return null;
  }
}

export function isDebugDumpEnabled(): boolean {
  return process.env[DEBUG_FLAG_ENV] === DEBUG_FLAG_VALUE;
}
