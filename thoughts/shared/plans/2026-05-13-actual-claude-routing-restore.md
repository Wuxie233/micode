---
date: 2026-05-13
topic: actual-claude-routing-restore
issue: 68
scope: config
contract: none
---

# Actual Claude Routing Restore Plan

**Goal:** Restore issue #68 rollback from the latest verified backups that contain the actual active Claude routes, without restarting OpenCode or printing secrets.

**Architecture:** This is a single operational restore task against the active OpenCode config files under `/root/.config/opencode`. The task first creates timestamped backups of the current active files, then restores the supplied backup files, validates parsing, and prints only a safe model-to-agent routing summary.

**Design:** Direct user request in current session; no separate design document.

**Contract:** none

---

## Dependency Graph

```text
Batch 1 (sequential safety task): 1.1 [backup -> restore -> parse validate -> safe route summary]
```

---

## Batch 1: Restore Active Configs (single task)

Task 1.1 is intentionally single-threaded because it writes live config files and must preserve backup-before-overwrite ordering.

### Task 1.1: Restore actual active Claude routing configs
**File:** `/root/.config/opencode/micode.jsonc` and `/root/.config/opencode/opencode.json`
**Test:** none
**Depends:** none
**Domain:** general
**Atlas-impact:** none

Restore sources and targets:

| Source backup | Active target |
|---|---|
| `/root/.config/opencode/micode.jsonc.bak-20260513-003543-fix-api` | `/root/.config/opencode/micode.jsonc` |
| `/root/.config/opencode/opencode.json.bak-20260513-003543-fix-api` | `/root/.config/opencode/opencode.json` |

Safety requirements:

- Do **not** restart OpenCode.
- Do **not** print provider credentials, API keys, tokens, full provider blocks, or raw config contents.
- Before overwrite, create backups of the current active targets with suffix `issue68-before-actual-claude-restore`, e.g. `/root/.config/opencode/micode.jsonc.bak-YYYYMMDD-HHMMSS-issue68-before-actual-claude-restore`.
- Validate `/root/.config/opencode/micode.jsonc` with JSONC parsing and `/root/.config/opencode/opencode.json` with strict JSON parsing after restore.
- Summarize only active routing grouped by `model`: default OpenCode model as `opencode.default`, plus `micode.agents.<agentName>` entries from `micode.jsonc`.

Run from `/root/CODE/micode`:

```bash
bun --cwd /root/CODE/micode --eval '
import { existsSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "-").replace(/\..+$/, "");
const suffix = `${stamp}-issue68-before-actual-claude-restore`;

const paths = {
  micodeSource: "/root/.config/opencode/micode.jsonc.bak-20260513-003543-fix-api",
  micodeTarget: "/root/.config/opencode/micode.jsonc",
  opencodeSource: "/root/.config/opencode/opencode.json.bak-20260513-003543-fix-api",
  opencodeTarget: "/root/.config/opencode/opencode.json",
};

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing: ${path}`);
  }
}

function parseJsoncFile(label, text) {
  const errors = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const details = errors.map((error) => `${printParseErrorCode(error.error)}@${error.offset}`).join(", ");
    throw new Error(`${label} JSONC parse failed: ${details}`);
  }
  return value;
}

function parseStrictJsonFile(label, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} JSON parse failed: ${message}`);
  }
}

function addRoute(groups, model, route) {
  if (typeof model !== "string" || model.trim().length === 0) return;
  const normalized = model.trim();
  const routes = groups.get(normalized) ?? [];
  routes.push(route);
  groups.set(normalized, routes);
}

for (const [label, path] of Object.entries(paths)) {
  assertExists(path, label);
}

const micodeSourceText = await readFile(paths.micodeSource, "utf8");
const opencodeSourceText = await readFile(paths.opencodeSource, "utf8");
parseJsoncFile("backup micode.jsonc", micodeSourceText);
parseStrictJsonFile("backup opencode.json", opencodeSourceText);

const micodeBackup = `${paths.micodeTarget}.bak-${suffix}`;
const opencodeBackup = `${paths.opencodeTarget}.bak-${suffix}`;
await copyFile(paths.micodeTarget, micodeBackup);
await copyFile(paths.opencodeTarget, opencodeBackup);

await copyFile(paths.micodeSource, paths.micodeTarget);
await copyFile(paths.opencodeSource, paths.opencodeTarget);

const micodeActive = parseJsoncFile("active micode.jsonc", await readFile(paths.micodeTarget, "utf8"));
const opencodeActive = parseStrictJsonFile("active opencode.json", await readFile(paths.opencodeTarget, "utf8"));

const groups = new Map();
addRoute(groups, opencodeActive?.model, "opencode.default");

const agents = micodeActive?.agents && typeof micodeActive.agents === "object" ? micodeActive.agents : {};
for (const agentName of Object.keys(agents).sort()) {
  addRoute(groups, agents[agentName]?.model, `micode.agents.${agentName}`);
}

console.log("RESTORE_OK");
console.log(`BACKUP_CREATED micode=${micodeBackup}`);
console.log(`BACKUP_CREATED opencode=${opencodeBackup}`);
console.log("GROUPED_ROUTING_SUMMARY");
for (const [model, routes] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`- ${model}: ${routes.sort().join(", ")}`);
}
'
```

**Verify:** command exits with `RESTORE_OK`, both `BACKUP_CREATED` lines are present, parsing completes without errors, and the output contains only `GROUPED_ROUTING_SUMMARY` grouped by model (no raw config, provider blocks, API keys, or tokens). Confirm separately that no OpenCode restart command was run.

**Commit:** none; this task changes live user config files outside the repository and should not create a code commit.
