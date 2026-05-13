---
date: 2026-05-13
topic: "claude-routing-reroute"
issue: 68
scope: config
contract: none
---

# Claude Routing Reroute Implementation Plan

**Goal:** Temporarily reroute active Claude-family micode/OpenCode model references to GPT-family replacements while preserving Claude provider registrations and rollback backups.

**Architecture:** This is a tiny runtime-configuration operation, not a code change. Each config file is mutated independently with a timestamped backup first; edits only touch active string values outside `provider` / `providers` definitions, so Claude model registrations remain available for rollback.

**Design:** Issue #68 lifecycle body (`lifecycle_context(68)`); no separate design document was present under `thoughts/shared/designs/`.

**Contract:** none

**Implementation decisions:** Desired mapping is implemented as `opus|sonnet -> wuxie-openai/gpt-5.5` and `haiku -> wuxie-openai/gpt-5.4mini`. Matching is case-insensitive on active string values and intentionally excludes provider-registration subtrees. No OpenCode restart is part of this plan.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [independent config files]
Batch 2 (parallel): 2.1 [cross-file verification after both config edits]
```

---

## Batch 1: Runtime Config Edits (parallel - 2 implementers)

Both tasks back up and mutate one config file only. They may run simultaneously because they touch different files.
Tasks: 1.1, 1.2

### Task 1.1: Reroute micode Agent Model Overrides
**File:** `/root/.config/opencode/micode.jsonc`
**Test:** none (runtime config mutation with backup + verification command; no repo test harness)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

Design requires safe mutation with rollback. Implementing it as a JSONC AST string-value rewrite because it preserves comments/formatting as much as possible and avoids touching provider definitions.

```bash
cd "/root/CODE/micode" && CONFIG_PATH="/root/.config/opencode/micode.jsonc" bun --eval "$(cat <<'TS'
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseTree } from "jsonc-parser";

const configPath = process.env.CONFIG_PATH;
if (!configPath) throw new Error("CONFIG_PATH is required");

const replacements = [
  { family: /haiku/i, target: "wuxie-openai/gpt-5.4mini" },
  { family: /(opus|sonnet)/i, target: "wuxie-openai/gpt-5.5" },
];

function isProviderPath(path: readonly (string | number)[]): boolean {
  return path[0] === "provider" || path[0] === "providers";
}

function replacementFor(value: string): string | null {
  if (!/(claude|anthropic|opus|sonnet|haiku)/i.test(value)) return null;
  return replacements.find((entry) => entry.family.test(value))?.target ?? null;
}

const source = readFileSync(configPath, "utf8");
const tree = parseTree(source);
if (!tree) throw new Error(`${basename(configPath)} is not valid JSON/JSONC`);

const edits: Array<{ offset: number; length: number; text: string }> = [];

function visit(node: any, path: Array<string | number>): void {
  if (node.type === "property") {
    const [keyNode, valueNode] = node.children ?? [];
    if (keyNode && valueNode) visit(valueNode, [...path, keyNode.value]);
    return;
  }
  if (node.type === "array") {
    (node.children ?? []).forEach((child: any, index: number) => visit(child, [...path, index]));
    return;
  }
  if (node.type === "object") {
    (node.children ?? []).forEach((child: any) => visit(child, path));
    return;
  }
  if (node.type !== "string" || isProviderPath(path)) return;
  const next = replacementFor(String(node.value));
  if (next && next !== node.value) edits.push({ offset: node.offset, length: node.length, text: JSON.stringify(next) });
}

visit(tree, []);
if (edits.length === 0) {
  console.log(`${basename(configPath)}: no active Claude-family routing strings required changes`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${configPath}.${stamp}.bak`;
copyFileSync(configPath, backupPath);

let output = source;
for (const edit of edits.sort((a, b) => b.offset - a.offset)) {
  output = output.slice(0, edit.offset) + edit.text + output.slice(edit.offset + edit.length);
}
if (!parseTree(output)) throw new Error(`${basename(configPath)} would become invalid JSON/JSONC`);
writeFileSync(configPath, output, "utf8");
console.log(`${basename(configPath)}: replaced ${edits.length} active routing string(s); backup=${basename(backupPath)}`);
TS
)"
```

**Verify:**
```bash
cd "/root/CODE/micode" && CONFIG_PATH="/root/.config/opencode/micode.jsonc" bun --eval "$(cat <<'TS'
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseTree } from "jsonc-parser";

const configPath = process.env.CONFIG_PATH!;
const source = readFileSync(configPath, "utf8");
const tree = parseTree(source);
if (!tree) throw new Error(`${basename(configPath)} is not valid JSON/JSONC`);
const violations: string[] = [];

function isProviderPath(path: readonly (string | number)[]): boolean {
  return path[0] === "provider" || path[0] === "providers";
}
function visit(node: any, path: Array<string | number>): void {
  if (node.type === "property") {
    const [keyNode, valueNode] = node.children ?? [];
    if (keyNode && valueNode) visit(valueNode, [...path, keyNode.value]);
    return;
  }
  if (node.type === "array") return (node.children ?? []).forEach((child: any, index: number) => visit(child, [...path, index]));
  if (node.type === "object") return (node.children ?? []).forEach((child: any) => visit(child, path));
  if (node.type === "string" && !isProviderPath(path) && /(claude|anthropic|opus|sonnet|haiku)/i.test(String(node.value))) violations.push(path.join("."));
}
visit(tree, []);
if (violations.length > 0) throw new Error(`${basename(configPath)} still has active Claude-family routing references at: ${violations.join(", ")}`);
console.log(`${basename(configPath)}: verified no active Claude-family routing references outside provider definitions`);
TS
)"
```
**Commit:** none (runtime config outside repo; plan commit handled separately)

### Task 1.2: Reroute OpenCode Default/Agent Model References
**File:** `/root/.config/opencode/opencode.json`
**Test:** none (runtime config mutation with backup + verification command; no repo test harness)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

Design requires preserving Claude provider registrations. Implementing it with the same path-aware JSONC rewrite, excluding `provider` / `providers` subtrees so configured Claude models remain available for rollback.

```bash
cd "/root/CODE/micode" && CONFIG_PATH="/root/.config/opencode/opencode.json" bun --eval "$(cat <<'TS'
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseTree } from "jsonc-parser";

const configPath = process.env.CONFIG_PATH;
if (!configPath) throw new Error("CONFIG_PATH is required");

const replacements = [
  { family: /haiku/i, target: "wuxie-openai/gpt-5.4mini" },
  { family: /(opus|sonnet)/i, target: "wuxie-openai/gpt-5.5" },
];

function isProviderPath(path: readonly (string | number)[]): boolean {
  return path[0] === "provider" || path[0] === "providers";
}

function replacementFor(value: string): string | null {
  if (!/(claude|anthropic|opus|sonnet|haiku)/i.test(value)) return null;
  return replacements.find((entry) => entry.family.test(value))?.target ?? null;
}

const source = readFileSync(configPath, "utf8");
const tree = parseTree(source);
if (!tree) throw new Error(`${basename(configPath)} is not valid JSON/JSONC`);

const edits: Array<{ offset: number; length: number; text: string }> = [];

function visit(node: any, path: Array<string | number>): void {
  if (node.type === "property") {
    const [keyNode, valueNode] = node.children ?? [];
    if (keyNode && valueNode) visit(valueNode, [...path, keyNode.value]);
    return;
  }
  if (node.type === "array") {
    (node.children ?? []).forEach((child: any, index: number) => visit(child, [...path, index]));
    return;
  }
  if (node.type === "object") {
    (node.children ?? []).forEach((child: any) => visit(child, path));
    return;
  }
  if (node.type !== "string" || isProviderPath(path)) return;
  const next = replacementFor(String(node.value));
  if (next && next !== node.value) edits.push({ offset: node.offset, length: node.length, text: JSON.stringify(next) });
}

visit(tree, []);
if (edits.length === 0) {
  console.log(`${basename(configPath)}: no active Claude-family routing strings required changes`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${configPath}.${stamp}.bak`;
copyFileSync(configPath, backupPath);

let output = source;
for (const edit of edits.sort((a, b) => b.offset - a.offset)) {
  output = output.slice(0, edit.offset) + edit.text + output.slice(edit.offset + edit.length);
}
if (!parseTree(output)) throw new Error(`${basename(configPath)} would become invalid JSON/JSONC`);
writeFileSync(configPath, output, "utf8");
console.log(`${basename(configPath)}: replaced ${edits.length} active routing string(s); backup=${basename(backupPath)}`);
TS
)"
```

**Verify:**
```bash
cd "/root/CODE/micode" && CONFIG_PATH="/root/.config/opencode/opencode.json" bun --eval "$(cat <<'TS'
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseTree } from "jsonc-parser";

const configPath = process.env.CONFIG_PATH!;
const source = readFileSync(configPath, "utf8");
const tree = parseTree(source);
if (!tree) throw new Error(`${basename(configPath)} is not valid JSON/JSONC`);
const violations: string[] = [];
let preservedProviderMentions = 0;

function isProviderPath(path: readonly (string | number)[]): boolean {
  return path[0] === "provider" || path[0] === "providers";
}
function visit(node: any, path: Array<string | number>): void {
  if (node.type === "property") {
    const [keyNode, valueNode] = node.children ?? [];
    if (keyNode && /(claude|anthropic|opus|sonnet|haiku)/i.test(String(keyNode.value)) && isProviderPath(path)) preservedProviderMentions += 1;
    if (keyNode && valueNode) visit(valueNode, [...path, keyNode.value]);
    return;
  }
  if (node.type === "array") return (node.children ?? []).forEach((child: any, index: number) => visit(child, [...path, index]));
  if (node.type === "object") return (node.children ?? []).forEach((child: any) => visit(child, path));
  if (node.type === "string" && /(claude|anthropic|opus|sonnet|haiku)/i.test(String(node.value))) {
    if (isProviderPath(path)) preservedProviderMentions += 1;
    else violations.push(path.join("."));
  }
}
visit(tree, []);
if (violations.length > 0) throw new Error(`${basename(configPath)} still has active Claude-family routing references at: ${violations.join(", ")}`);
console.log(`${basename(configPath)}: verified active routing clean; provider Claude-family mention count preserved/readable=${preservedProviderMentions}`);
TS
)"
```
**Commit:** none (runtime config outside repo; plan commit handled separately)

---

## Batch 2: Cross-file Verification (parallel - 1 implementer)

This task depends on Batch 1 completing and performs the final no-secrets verification pass.
Tasks: 2.1

### Task 2.1: Verify Cross-file Routing State
**File:** `/root/.config/opencode/opencode.json` (read-only verification; also reads `/root/.config/opencode/micode.jsonc`)
**Test:** none (read-only runtime verification)
**Depends:** 1.1, 1.2
**Domain:** general
**Atlas-impact:** none

Design requires proving no active routing/default references still point at Claude family while provider definitions remain untouched. Implementing this as a read-only JSONC traversal that prints only file basenames, safe paths, counts, and expected target counts; it never prints config values or credentials.

```bash
cd "/root/CODE/micode" && bun --eval "$(cat <<'TS'
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseTree } from "jsonc-parser";

const files = ["/root/.config/opencode/micode.jsonc", "/root/.config/opencode/opencode.json"];
const expectedTargets = new Set(["wuxie-openai/gpt-5.5", "wuxie-openai/gpt-5.4mini"]);
const allViolations: string[] = [];
let activeTargetCount = 0;
let providerClaudeMentionCount = 0;

function isProviderPath(path: readonly (string | number)[]): boolean {
  return path[0] === "provider" || path[0] === "providers";
}

function inspectFile(configPath: string): void {
  const source = readFileSync(configPath, "utf8");
  const tree = parseTree(source);
  if (!tree) throw new Error(`${basename(configPath)} is not valid JSON/JSONC`);
  const localViolations: string[] = [];
  let localTargets = 0;
  let localProviderMentions = 0;

  function visit(node: any, path: Array<string | number>): void {
    if (node.type === "property") {
      const [keyNode, valueNode] = node.children ?? [];
      if (keyNode && /(claude|anthropic|opus|sonnet|haiku)/i.test(String(keyNode.value)) && isProviderPath(path)) localProviderMentions += 1;
      if (keyNode && valueNode) visit(valueNode, [...path, keyNode.value]);
      return;
    }
    if (node.type === "array") return (node.children ?? []).forEach((child: any, index: number) => visit(child, [...path, index]));
    if (node.type === "object") return (node.children ?? []).forEach((child: any) => visit(child, path));
    if (node.type !== "string") return;
    const value = String(node.value);
    if (expectedTargets.has(value) && !isProviderPath(path)) localTargets += 1;
    if (/(claude|anthropic|opus|sonnet|haiku)/i.test(value)) {
      if (isProviderPath(path)) localProviderMentions += 1;
      else localViolations.push(path.join("."));
    }
  }

  visit(tree, []);
  activeTargetCount += localTargets;
  providerClaudeMentionCount += localProviderMentions;
  allViolations.push(...localViolations.map((path) => `${basename(configPath)}:${path}`));
  console.log(`${basename(configPath)}: expected active target count=${localTargets}; provider Claude-family mention count=${localProviderMentions}`);
}

for (const file of files) inspectFile(file);
if (allViolations.length > 0) throw new Error(`active Claude-family routing references remain at: ${allViolations.join(", ")}`);
if (activeTargetCount === 0) throw new Error("no active GPT replacement targets found; reroute likely did not apply");
console.log(`verified: active Claude-family routing references=0; total replacement target count=${activeTargetCount}; provider registrations still readable=${providerClaudeMentionCount}`);
console.log("no OpenCode restart performed by this plan");
TS
)"
```

**Verify:** command above exits 0 and prints no secrets; additionally confirm backup files exist by basename only if needed with `python3 - <<'PY'` that lists `/root/.config/opencode/*.bak` basenames.
**Commit:** none (read-only verification; plan commit handled separately)
