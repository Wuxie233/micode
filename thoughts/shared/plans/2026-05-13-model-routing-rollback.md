---
date: 2026-05-13
topic: "model-routing-rollback"
issue: 68
scope: config
contract: none
---

# Model Routing Rollback Implementation Plan

**Goal:** Restore the pre-reroute OpenCode/micode runtime model routing by replacing the active runtime config files with the specified issue #68 backups, while preserving current files first.

**Architecture:** This is an operational rollback, not a code change. Use a single guarded shell procedure so backup, restore, parse validation, and non-secret routing summary happen in one auditable step; do not restart OpenCode and do not print raw config contents or secrets.

**Design:** inline user request (no separate design document for this minimal rollback plan)

**Contract:** none

**Decisions:** Design requires fresh backups before overwrite. Implementing backups as same-directory timestamped copies named `micode.jsonc.bak-<YYYYMMDD-HHMMSS>-issue68-pre-rollback` and `opencode.json.bak-<YYYYMMDD-HHMMSS>-issue68-pre-rollback` because this preserves rollback locality and avoids touching unrelated project files.

---

## Dependency Graph

```text
Batch 1 (parallel): 1.1 [rollback operation - no deps]
```

---

## Batch 1: Rollback Operation (parallel - 1 implementer)

This batch has NO dependencies. It intentionally contains one task because both target files must be backed up and restored atomically enough for the runtime config pair to stay consistent.
Tasks: 1.1

### Task 1.1: Restore pre-reroute runtime model routing configs
**File:** `/root/.config/opencode/micode.jsonc`
**Test:** none
**Depends:** none
**Domain:** general
**Atlas-impact:** none

```sh
set -eu

MICODE_ACTIVE="/root/.config/opencode/micode.jsonc"
MICODE_BACKUP="/root/.config/opencode/micode.jsonc.bak-20260513-025542-issue68-reroute"
OPENCODE_ACTIVE="/root/.config/opencode/opencode.json"
OPENCODE_BACKUP="/root/.config/opencode/opencode.json.bak-20260513-025503-issue68-reroute"
STAMP="$(date +%Y%m%d-%H%M%S)"

for path in "$MICODE_ACTIVE" "$MICODE_BACKUP" "$OPENCODE_ACTIVE" "$OPENCODE_BACKUP"; do
  if [ ! -f "$path" ]; then
    printf 'Missing required file: %s\n' "$path" >&2
    exit 1
  fi
done

cp -p "$MICODE_ACTIVE" "/root/.config/opencode/micode.jsonc.bak-${STAMP}-issue68-pre-rollback"
cp -p "$OPENCODE_ACTIVE" "/root/.config/opencode/opencode.json.bak-${STAMP}-issue68-pre-rollback"

cp -p "$MICODE_BACKUP" "$MICODE_ACTIVE"
cp -p "$OPENCODE_BACKUP" "$OPENCODE_ACTIVE"

bun --silent <<'EOF'
import { readFileSync } from "node:fs";
import { parse as parseJsonc } from "jsonc-parser";

const micodePath = "/root/.config/opencode/micode.jsonc";
const opencodePath = "/root/.config/opencode/opencode.json";

function redactModel(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "unset";
  const slash = value.indexOf("/");
  if (slash <= 0) return "configured(model redacted)";
  return `${value.slice(0, slash)}/<model-redacted>`;
}

function readJsonc(path: string): unknown {
  const errors: unknown[] = [];
  const parsed = parseJsonc(readFileSync(path, "utf8"), errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(`${path} failed JSON/JSONC parse validation`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const micode = readJsonc(micodePath);
const opencode = readJsonc(opencodePath);

if (!isRecord(micode)) throw new Error(`${micodePath} must parse to an object`);
if (!isRecord(opencode)) throw new Error(`${opencodePath} must parse to an object`);

const opencodeDefault = redactModel(opencode.model);
const agents = isRecord(micode.agents) ? micode.agents : {};
const routedAgents = Object.entries(agents)
  .filter(([, config]) => isRecord(config) && typeof config.model === "string" && config.model.length > 0)
  .map(([agent, config]) => `${agent}=>${redactModel((config as Record<string, unknown>).model)}`)
  .sort();

console.log("Validation: restored config files parse successfully.");
console.log(`Routing summary: opencode default=${opencodeDefault}; micode per-agent overrides=${routedAgents.length}`);
for (const line of routedAgents) console.log(`- ${line}`);
console.log("No OpenCode restart performed by this rollback task.");
EOF
```

**Verify:** `bun --silent -e 'import { readFileSync } from "node:fs"; import { parse } from "jsonc-parser"; for (const path of ["/root/.config/opencode/micode.jsonc", "/root/.config/opencode/opencode.json"]) { const errors = []; parse(readFileSync(path, "utf8"), errors, { allowTrailingComma: true }); if (errors.length) throw new Error(`${path} parse failed`); } console.log("config parse ok")'`
**Commit:** none (operational runtime rollback; do not commit secrets or runtime-local config)
