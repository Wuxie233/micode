---
date: 2026-05-07
topic: "Atlas v2 Lookup and Display"
issue: 51
scope: atlas
contract: none
---

# Atlas v2 Lookup and Display Implementation Plan

**Goal:** Wire `atlas_lookup` tool, render Sources as clickable GitHub permalinks, attach display metadata (`title`/`aliases`/`source_path`) via frontmatter extras, extend atlas-translator for incremental migration, and expose `getAtlasSummary()` foundation for B-final auto-inject.

**Architecture:** Compatible extension of existing atlas schema. Keep `sources: string[]` flat (parser/serializer/workers/reconciler unchanged); add display metadata in `frontmatter.extras`; render Sources body bullets through a new `formatSourceLink()` helper that converts `code:src/...` into GitHub permalinks. New tool `atlas_lookup` mirrors the simple `mindmodel_lookup` shape: local vault scan, soft-error markdown output, no DB.

**Design:** [thoughts/shared/designs/2026-05-07-atlas-v2-lookup-display-design.md](../designs/2026-05-07-atlas-v2-lookup-display-design.md)

**Contract:** none (single-domain, all tasks `Domain: general` — backend-shaped infra code with no frontend surface).

**Key gap-fills (planner decisions when design is silent):**

- **Source link format.** Design says `code:src/...` → `[查看源码 src/...](GH_URL)`. Implementing GH base URL resolution by reading `package.json#repository.url` first, then `git config --get remote.origin.url`, then falling back to `https://github.com/Wuxie233/micode`. SHA pinning uses `frontmatter.last_verified_commit` when non-empty, otherwise `main`.
- **Vault tolerance.** Existing nodes use lightweight `tags: [atlas, impl]` frontmatter (no `id`/`layer`/`status`/`sources`). `atlas_lookup` must scan via tolerant raw-markdown parsing (split on `---` delimiters, accept any frontmatter shape, derive `layer` from directory `10-impl|20-behavior|30-context|40-decisions|50-risks|60-timeline`, derive `title` from H1, derive `summary` from first prose paragraph). Do NOT call the strict `parseFrontmatter` from `src/atlas/frontmatter.ts` — it requires `id/layer/status/last_verified_commit/last_written_mtime` and would throw on every existing node.
- **Auto-inject token budget.** Design says < 2000 tokens. Implementing as `getAtlasSummary({ maxBytes: 6000 })` (≈ 1500–2000 CJK tokens). Reads `atlas/00-index.md` verbatim, then appends one-line excerpts (first prose paragraph) from up to 5 nodes whose names match a small allowlist (lifecycle, octto, agent registry, plugin composition). Returns null when vault missing.
- **Translator scope.** New responsibility: rewrite Sources body bullets from `code:src/...` to GitHub permalink markdown, AND inject `title`/`aliases`/`source_path` into frontmatter `extras`. Keep H1 unchanged, keep wikilinks unchanged, keep `sources:` frontmatter list unchanged (machine identifiers).
- **README plugin docs.** Append a "## Obsidian display plugin" section documenting `obsidian-front-matter-title` and the graceful fallback when not installed.

---

## Dependency Graph

```
Batch 1 (parallel, 5 tasks): foundation, no deps
  1.1 src/atlas/source-link.ts                 (formatter helper)
  1.2 src/atlas/repo-url.ts                     (GitHub base URL resolver)
  1.3 src/atlas/display-extras.ts               (title/aliases/source_path derivation)
  1.4 src/atlas/auto-inject.ts                  (getAtlasSummary)
  1.5 atlas/README.md                           (plugin docs append)

Batch 2 (parallel, 5 tasks): core wiring, depends on Batch 1
  2.1 src/tools/atlas/lookup.ts                 (atlas_lookup tool factory; deps 1.1, 1.2)
  2.2 src/atlas/cold-init/renderer.ts           (renderer uses 1.1, 1.3)
  2.3 src/atlas/templates.ts                    (templates use 1.1, 1.3)
  2.4 src/agents/atlas-translator.ts            (prompt extension)
  2.5 src/tools/atlas/index.ts                  (export lookup factory)

Batch 3 (sequential, 2 tasks): registration, depends on Batch 2
  3.1 src/tools/index.ts                        (re-export factory)
  3.2 src/index.ts                              (register atlas_lookup tool)
```

---

## Batch 1: Foundation (parallel - 5 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

### Task 1.1: Source pointer → GitHub permalink formatter
**File:** `src/atlas/source-link.ts`
**Test:** `tests/atlas/source-link.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/atlas/source-link.test.ts
import { describe, expect, it } from "bun:test";

import { formatSourceLink } from "@/atlas/source-link";

const REPO_BASE = "https://github.com/Wuxie233/micode";

describe("formatSourceLink", () => {
  it("renders code: pointer as a GitHub permalink markdown link", () => {
    const out = formatSourceLink("code:src/lifecycle/runner.ts", { repoBase: REPO_BASE, ref: "main" });
    expect(out).toBe(`[查看源码 src/lifecycle/runner.ts](${REPO_BASE}/blob/main/src/lifecycle/runner.ts)`);
  });

  it("uses the supplied commit ref when present", () => {
    const out = formatSourceLink("code:src/foo.ts", { repoBase: REPO_BASE, ref: "abc1234" });
    expect(out).toBe(`[查看源码 src/foo.ts](${REPO_BASE}/blob/abc1234/src/foo.ts)`);
  });

  it("preserves a line anchor in the path", () => {
    const out = formatSourceLink("code:src/foo.ts#L10-L20", { repoBase: REPO_BASE, ref: "main" });
    expect(out).toBe(`[查看源码 src/foo.ts#L10-L20](${REPO_BASE}/blob/main/src/foo.ts#L10-L20)`);
  });

  it("returns the original bullet for non-code pointers", () => {
    expect(formatSourceLink("lifecycle:42", { repoBase: REPO_BASE, ref: "main" })).toBe("lifecycle:42");
    expect(formatSourceLink("thoughts:shared/designs/foo.md", { repoBase: REPO_BASE, ref: "main" })).toBe(
      "thoughts:shared/designs/foo.md",
    );
  });

  it("returns the original bullet when input is not a parseable pointer", () => {
    expect(formatSourceLink("just plain text", { repoBase: REPO_BASE, ref: "main" })).toBe("just plain text");
  });

  it("strips a trailing slash from repoBase before joining", () => {
    const out = formatSourceLink("code:src/x.ts", { repoBase: `${REPO_BASE}/`, ref: "main" });
    expect(out).toBe(`[查看源码 src/x.ts](${REPO_BASE}/blob/main/src/x.ts)`);
  });
});
```

```typescript
// src/atlas/source-link.ts
import { POINTER_KINDS, tryParsePointer } from "./pointer";

export interface SourceLinkContext {
  readonly repoBase: string;
  readonly ref: string;
}

const TRAILING_SLASH = /\/+$/u;

const stripTrailingSlash = (raw: string): string => raw.replace(TRAILING_SLASH, "");

/**
 * Render a source bullet for the body Sources section.
 *
 * - `code:src/foo.ts` becomes a markdown link to the GitHub permalink.
 * - All other pointer kinds (lifecycle, thoughts, pm, mindmodel) and
 *   unparseable bullets are returned verbatim so the renderer never
 *   produces a broken link.
 */
export function formatSourceLink(raw: string, ctx: SourceLinkContext): string {
  const pointer = tryParsePointer(raw);
  if (pointer === null || pointer.kind !== POINTER_KINDS.CODE) return raw;
  const base = stripTrailingSlash(ctx.repoBase);
  const url = `${base}/blob/${ctx.ref}/${pointer.value}`;
  return `[查看源码 ${pointer.value}](${url})`;
}
```

**Verify:** `bun test tests/atlas/source-link.test.ts`
**Commit:** `feat(atlas): add formatSourceLink helper for GitHub permalinks`

---

### Task 1.2: GitHub repo base URL resolver
**File:** `src/atlas/repo-url.ts`
**Test:** `tests/atlas/repo-url.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/atlas/repo-url.test.ts
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ATLAS_REPO_FALLBACK_BASE, resolveRepoBase } from "@/atlas/repo-url";

const makeTmp = (): string => mkdtempSync(join(tmpdir(), "atlas-repo-url-"));

describe("resolveRepoBase", () => {
  it("reads https URL from package.json#repository.url", () => {
    const root = makeTmp();
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ repository: { type: "git", url: "https://github.com/foo/bar.git" } }),
      );
      expect(resolveRepoBase(root)).toBe("https://github.com/foo/bar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes git+https URLs", () => {
    const root = makeTmp();
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ repository: { url: "git+https://github.com/foo/bar.git" } }),
      );
      expect(resolveRepoBase(root)).toBe("https://github.com/foo/bar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes git@ SSH URLs", () => {
    const root = makeTmp();
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ repository: { url: "git@github.com:foo/bar.git" } }),
      );
      expect(resolveRepoBase(root)).toBe("https://github.com/foo/bar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a plain string repository field", () => {
    const root = makeTmp();
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ repository: "https://github.com/foo/bar" }),
      );
      expect(resolveRepoBase(root)).toBe("https://github.com/foo/bar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back when package.json is missing", () => {
    const root = makeTmp();
    try {
      expect(resolveRepoBase(root)).toBe(ATLAS_REPO_FALLBACK_BASE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back when package.json has no repository field", () => {
    const root = makeTmp();
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo" }));
      expect(resolveRepoBase(root)).toBe(ATLAS_REPO_FALLBACK_BASE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back when package.json is malformed", () => {
    const root = makeTmp();
    try {
      writeFileSync(join(root, "package.json"), "{ not json");
      expect(resolveRepoBase(root)).toBe(ATLAS_REPO_FALLBACK_BASE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

```typescript
// src/atlas/repo-url.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ATLAS_REPO_FALLBACK_BASE = "https://github.com/Wuxie233/micode";

const SSH_PATTERN = /^git@([^:]+):(.+?)(?:\.git)?$/u;
const GIT_PLUS_PREFIX = /^git\+/u;
const TRAILING_DOT_GIT = /\.git$/u;

const normalizeUrl = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const sshMatch = SSH_PATTERN.exec(trimmed);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2].replace(TRAILING_DOT_GIT, "")}`;
  const stripped = trimmed.replace(GIT_PLUS_PREFIX, "").replace(TRAILING_DOT_GIT, "");
  if (!stripped.startsWith("https://") && !stripped.startsWith("http://")) return null;
  return stripped;
};

interface PackageRepository {
  readonly repository?: string | { readonly url?: string };
}

const readRepository = (root: string): string | null => {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;
  let parsed: PackageRepository;
  try {
    parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageRepository;
  } catch {
    return null;
  }
  const repo = parsed.repository;
  if (typeof repo === "string") return repo;
  if (repo && typeof repo === "object" && typeof repo.url === "string") return repo.url;
  return null;
};

/**
 * Resolve the repo base URL for source permalinks.
 *
 * Priority:
 * 1. `package.json#repository.url` (or string form)
 * 2. Hardcoded fallback `ATLAS_REPO_FALLBACK_BASE`
 *
 * Returned URL has no trailing `.git` and no trailing slash.
 */
export function resolveRepoBase(projectRoot: string): string {
  const fromPkg = readRepository(projectRoot);
  if (fromPkg !== null) {
    const normalized = normalizeUrl(fromPkg);
    if (normalized !== null) return normalized;
  }
  return ATLAS_REPO_FALLBACK_BASE;
}
```

**Verify:** `bun test tests/atlas/repo-url.test.ts`
**Commit:** `feat(atlas): resolve repo base URL for source permalinks`

---

### Task 1.3: Display extras derivation (title / aliases / source_path)
**File:** `src/atlas/display-extras.ts`
**Test:** `tests/atlas/display-extras.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/atlas/display-extras.test.ts
import { describe, expect, it } from "bun:test";

import { deriveDisplayExtras } from "@/atlas/display-extras";

describe("deriveDisplayExtras", () => {
  it("returns title, aliases, and source_path when title and a code source are provided", () => {
    const out = deriveDisplayExtras({
      title: "Lifecycle 状态机",
      id: "10-impl/lifecycle-state-machine",
      sources: ["code:src/lifecycle/runner.ts", "thoughts:shared/designs/x.md"],
    });
    expect(out).toEqual({
      title: "Lifecycle 状态机",
      aliases: "10-impl/lifecycle-state-machine",
      source_path: "src/lifecycle/runner.ts",
    });
  });

  it("omits source_path when no code: pointer is present", () => {
    const out = deriveDisplayExtras({
      title: "决策记录",
      id: "40-decisions/foo",
      sources: ["thoughts:shared/designs/x.md"],
    });
    expect(out.source_path).toBeUndefined();
    expect(out.title).toBe("决策记录");
    expect(out.aliases).toBe("40-decisions/foo");
  });

  it("uses the FIRST code: pointer when multiple are present", () => {
    const out = deriveDisplayExtras({
      title: "T",
      id: "id",
      sources: ["code:src/a.ts", "code:src/b.ts"],
    });
    expect(out.source_path).toBe("src/a.ts");
  });

  it("strips a #L line anchor from source_path", () => {
    const out = deriveDisplayExtras({
      title: "T",
      id: "id",
      sources: ["code:src/a.ts#L10-L20"],
    });
    expect(out.source_path).toBe("src/a.ts");
  });

  it("omits title when empty or whitespace only", () => {
    const out = deriveDisplayExtras({ title: "   ", id: "id", sources: [] });
    expect(out.title).toBeUndefined();
    expect(out.aliases).toBe("id");
  });

  it("omits aliases when id equals title (no extra information)", () => {
    const out = deriveDisplayExtras({ title: "Same", id: "Same", sources: [] });
    expect(out.aliases).toBeUndefined();
    expect(out.title).toBe("Same");
  });
});
```

```typescript
// src/atlas/display-extras.ts
import { POINTER_KINDS, tryParsePointer } from "./pointer";

const LINE_ANCHOR = /#L\d+(?:-L?\d+)?$/u;

export interface DisplayExtrasInput {
  readonly title: string;
  readonly id: string;
  readonly sources: readonly string[];
}

export interface DisplayExtras {
  readonly title?: string;
  readonly aliases?: string;
  readonly source_path?: string;
}

const stripLineAnchor = (path: string): string => path.replace(LINE_ANCHOR, "");

const firstCodeSourcePath = (sources: readonly string[]): string | undefined => {
  for (const raw of sources) {
    const pointer = tryParsePointer(raw);
    if (pointer && pointer.kind === POINTER_KINDS.CODE) return stripLineAnchor(pointer.value);
  }
  return undefined;
};

/**
 * Derive frontmatter `extras` for display:
 *
 * - `title`: human-readable display name (Chinese after translator, English on cold-init).
 * - `aliases`: stable machine id, kept so wikilinks can still resolve when the
 *   `obsidian-front-matter-title` plugin renames the visible label.
 * - `source_path`: relative repo path of the FIRST `code:` pointer; used by
 *   future tooling to map nodes to files in IDEs.
 *
 * Empty or redundant fields are omitted so we never emit `extras: { title: "" }`.
 */
export function deriveDisplayExtras(input: DisplayExtrasInput): DisplayExtras {
  const trimmedTitle = input.title.trim();
  const out: { -readonly [K in keyof DisplayExtras]: DisplayExtras[K] } = {};
  if (trimmedTitle.length > 0) out.title = trimmedTitle;
  if (input.id.length > 0 && input.id !== trimmedTitle) out.aliases = input.id;
  const codePath = firstCodeSourcePath(input.sources);
  if (codePath !== undefined) out.source_path = codePath;
  return out;
}
```

**Verify:** `bun test tests/atlas/display-extras.test.ts`
**Commit:** `feat(atlas): derive title/aliases/source_path display extras`

---

### Task 1.4: getAtlasSummary auto-inject foundation
**File:** `src/atlas/auto-inject.ts`
**Test:** `tests/atlas/auto-inject.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/atlas/auto-inject.test.ts
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAtlasSummary } from "@/atlas/auto-inject";

const makeTmpVault = (): string => mkdtempSync(join(tmpdir(), "atlas-auto-inject-"));

const writeFile = (root: string, rel: string, body: string): void => {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
};

describe("getAtlasSummary", () => {
  it("returns null when atlas/ vault does not exist", async () => {
    const root = makeTmpVault();
    try {
      expect(await getAtlasSummary(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when atlas/00-index.md is missing", async () => {
    const root = makeTmpVault();
    try {
      mkdirSync(join(root, "atlas"));
      expect(await getAtlasSummary(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes the index body verbatim when vault is initialized", async () => {
    const root = makeTmpVault();
    try {
      writeFile(
        root,
        "atlas/00-index.md",
        "---\ntags: [atlas, index]\n---\n# micode Atlas Index\n\nDescription.\n\n## Build Layer\n\n- [[Plugin Composition]]\n",
      );
      const out = await getAtlasSummary(root);
      expect(out).not.toBeNull();
      expect(out).toContain("# micode Atlas Index");
      expect(out).toContain("Plugin Composition");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("respects the maxBytes budget", async () => {
    const root = makeTmpVault();
    try {
      const long = "x".repeat(20000);
      writeFile(root, "atlas/00-index.md", `---\ntags: [atlas]\n---\n# Index\n\n${long}\n`);
      const out = await getAtlasSummary(root, { maxBytes: 500 });
      expect(out).not.toBeNull();
      expect(Buffer.byteLength(out ?? "", "utf8")).toBeLessThanOrEqual(500);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("appends excerpts from allowlisted nodes when present", async () => {
    const root = makeTmpVault();
    try {
      writeFile(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n\nIntro.\n");
      writeFile(
        root,
        "atlas/10-impl/lifecycle-state-machine.md",
        "---\ntags: [atlas, impl]\n---\n# Lifecycle State Machine\n\n生命周期状态机摘要文本。\n",
      );
      const out = (await getAtlasSummary(root)) ?? "";
      expect(out).toContain("Lifecycle State Machine");
      expect(out).toContain("生命周期状态机摘要文本");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

```typescript
// src/atlas/auto-inject.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ATLAS_INDEX_FILE, ATLAS_ROOT_DIRNAME } from "./config";

const DEFAULT_MAX_BYTES = 6000;

/**
 * Files appended (in order) after the index, when present.
 * Each entry is read, the H1+first prose paragraph extracted, and joined.
 * Allowlist is intentionally short to keep the summary auto-inject-budget friendly.
 */
const KEY_NODES: readonly string[] = [
  "10-impl/plugin-composition.md",
  "10-impl/lifecycle-state-machine.md",
  "10-impl/agent-registry.md",
  "10-impl/octto-session-system.md",
  "20-behavior/issue-driven-lifecycle.md",
];

export interface AtlasSummaryOptions {
  readonly maxBytes?: number;
}

const FRONTMATTER_DELIMITER = "---";

const stripFrontmatter = (raw: string): string => {
  if (!raw.startsWith(`${FRONTMATTER_DELIMITER}\n`)) return raw;
  const close = raw.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length + 1);
  if (close === -1) return raw;
  return raw.slice(close + FRONTMATTER_DELIMITER.length + 2).replace(/^\n/, "");
};

const extractH1AndFirstProse = (body: string): string => {
  const lines = body.split("\n");
  const out: string[] = [];
  let sawH1 = false;
  let sawFirstProse = false;
  for (const line of lines) {
    if (!sawH1 && line.startsWith("# ")) {
      out.push(line);
      sawH1 = true;
      continue;
    }
    if (sawH1 && !sawFirstProse) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith("#")) break;
      out.push(line);
      sawFirstProse = true;
      continue;
    }
    if (sawFirstProse) break;
  }
  return out.join("\n");
};

const truncateToBytes = (text: string, maxBytes: number): string => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const buf = Buffer.from(text, "utf8");
  return buf.subarray(0, maxBytes).toString("utf8");
};

const readNodeExcerpt = (vaultRoot: string, rel: string): string | null => {
  const full = join(vaultRoot, rel);
  if (!existsSync(full)) return null;
  const raw = readFileSync(full, "utf8");
  const body = stripFrontmatter(raw);
  const excerpt = extractH1AndFirstProse(body).trim();
  if (excerpt.length === 0) return null;
  return excerpt;
};

/**
 * Build a small atlas summary for prompt auto-inject.
 *
 * Returns null when the vault is not initialized so callers can fall back
 * to "no atlas" behavior. B-final issue wires this into brainstormer/planner
 * prompts; this issue only provides the helper.
 */
export async function getAtlasSummary(projectRoot: string, options?: AtlasSummaryOptions): Promise<string | null> {
  const vault = join(projectRoot, ATLAS_ROOT_DIRNAME);
  const index = join(vault, ATLAS_INDEX_FILE);
  if (!existsSync(vault) || !existsSync(index)) return null;
  const raw = readFileSync(index, "utf8");
  const indexBody = stripFrontmatter(raw).trim();

  const sections: string[] = [indexBody];
  for (const rel of KEY_NODES) {
    const excerpt = readNodeExcerpt(vault, rel);
    if (excerpt !== null) sections.push(excerpt);
  }
  const joined = sections.join("\n\n---\n\n");
  return truncateToBytes(joined, options?.maxBytes ?? DEFAULT_MAX_BYTES);
}
```

**Verify:** `bun test tests/atlas/auto-inject.test.ts`
**Commit:** `feat(atlas): add getAtlasSummary auto-inject foundation`

---

### Task 1.5: atlas/README.md plugin docs
**File:** `atlas/README.md`
**Test:** none (documentation-only Markdown change; low-risk per semantic-risk rule)
**Depends:** none
**Domain:** general

Append the following section to the existing `atlas/README.md` (do not rewrite the existing content):

```markdown
## Obsidian display plugin

`atlas/` 目录是稳定的 Obsidian vault。文件名和 wikilink target 始终是英文路径，作为机器 ID 不会被翻译或重命名。

为了在 Obsidian graph view 和文件树中看到中文显示名，需要安装社区插件 [`obsidian-front-matter-title`](https://github.com/snezhig/obsidian-front-matter-title)：

1. 在 Obsidian 设置中打开 Community Plugins，搜索 "Front Matter Title" 并启用。
2. 在插件配置里把 `title` 设为 frontmatter 中的展示字段。
3. 启用后 graph view、文件树、wikilink 自动补全都会显示节点 frontmatter 中的中文 `title`。

未安装该插件时，vault 仍然完全可用：节点会以英文文件名展示，wikilinks 仍然指向正确目标。这是有意为之的渐进增强，不会因为缺插件而损坏 atlas。

## Source links

每个节点的 `## Sources` 正文把 `code:src/...` 类型的来源渲染成可点击的 GitHub permalink。Frontmatter 的 `sources:` 列表保留原始 pointer 字符串，是 reconciler、worker 和 challenge 流程的机器接口，不要手动改写。
```

**Verify:** `grep -q "obsidian-front-matter-title" atlas/README.md && grep -q "Source links" atlas/README.md`
**Commit:** `docs(atlas): document obsidian-front-matter-title plugin and source links`

---

## Batch 2: Core Wiring (parallel - 5 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4, 2.5

### Task 2.1: atlas_lookup tool factory
**File:** `src/tools/atlas/lookup.ts`
**Test:** `tests/tools/atlas-lookup.test.ts`
**Depends:** 1.1, 1.2
**Domain:** general

```typescript
// tests/tools/atlas-lookup.test.ts
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAtlasLookupTool } from "@/tools/atlas/lookup";

const makeTmp = (): string => mkdtempSync(join(tmpdir(), "atlas-lookup-"));

const writeNode = (root: string, rel: string, body: string): void => {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
};

const ctx = (directory: string): Parameters<typeof createAtlasLookupTool>[0] =>
  ({ directory }) as Parameters<typeof createAtlasLookupTool>[0];

const runLookup = async (root: string, args: { query: string; layer?: string; limit?: number }): Promise<string> => {
  const { atlas_lookup } = createAtlasLookupTool(ctx(root));
  const exec = atlas_lookup.execute as (a: typeof args) => Promise<string>;
  return exec(args);
};

describe("atlas_lookup tool", () => {
  it("returns 'Atlas not initialized' when atlas/ vault is missing", async () => {
    const root = makeTmp();
    try {
      const out = await runLookup(root, { query: "lifecycle" });
      expect(out).toContain("Atlas not initialized");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("matches a node by H1 title and returns its excerpt", async () => {
    const root = makeTmp();
    try {
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      writeNode(
        root,
        "atlas/10-impl/lifecycle-state-machine.md",
        "---\ntags: [atlas, impl]\n---\n# Lifecycle State Machine\n\n生命周期状态机摘要。\n\n## Sources\n\n- code:src/lifecycle/runner.ts\n",
      );
      const out = await runLookup(root, { query: "lifecycle" });
      expect(out).toContain("Lifecycle State Machine");
      expect(out).toContain("生命周期状态机摘要");
      expect(out).toContain("atlas/10-impl/lifecycle-state-machine.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("filters by layer when layer arg is supplied", async () => {
    const root = makeTmp();
    try {
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      writeNode(
        root,
        "atlas/10-impl/lifecycle.md",
        "---\ntags: [atlas, impl]\n---\n# Lifecycle\n\nimpl summary.\n",
      );
      writeNode(
        root,
        "atlas/40-decisions/lifecycle.md",
        "---\ntags: [atlas, decision]\n---\n# Lifecycle Decision\n\ndecision summary.\n",
      );
      const out = await runLookup(root, { query: "lifecycle", layer: "decision" });
      expect(out).toContain("Lifecycle Decision");
      expect(out).not.toContain("impl summary");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("respects limit", async () => {
    const root = makeTmp();
    try {
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      for (let i = 0; i < 5; i += 1) {
        writeNode(
          root,
          `atlas/10-impl/topic-${i}.md`,
          `---\ntags: [atlas, impl]\n---\n# Topic ${i}\n\nlookup-target body ${i}.\n`,
        );
      }
      const out = await runLookup(root, { query: "lookup-target", limit: 2 });
      const matches = (out.match(/^### /gmu) ?? []).length;
      expect(matches).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes _meta and _archive directories", async () => {
    const root = makeTmp();
    try {
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      writeNode(
        root,
        "atlas/_meta/log/init.md",
        "---\ntags: [atlas]\n---\n# Init Log\n\nshould-not-appear.\n",
      );
      writeNode(
        root,
        "atlas/_archive/old.md",
        "---\ntags: [atlas]\n---\n# Archived\n\nshould-not-appear.\n",
      );
      const out = await runLookup(root, { query: "should-not-appear" });
      expect(out).not.toContain("Init Log");
      expect(out).not.toContain("Archived");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renders code: source bullets as GitHub permalinks", async () => {
    const root = makeTmp();
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ repository: { url: "https://github.com/foo/bar.git" } }),
      );
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      writeNode(
        root,
        "atlas/10-impl/runner.md",
        "---\ntags: [atlas, impl]\n---\n# Runner\n\nrunner-summary.\n\n## Sources\n\n- code:src/runner.ts\n",
      );
      const out = await runLookup(root, { query: "runner-summary" });
      expect(out).toContain("https://github.com/foo/bar/blob/");
      expect(out).toContain("src/runner.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns no-hit guidance when query matches nothing", async () => {
    const root = makeTmp();
    try {
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      writeNode(root, "atlas/10-impl/x.md", "---\ntags: [atlas, impl]\n---\n# X\n\nbody.\n");
      const out = await runLookup(root, { query: "completely-unrelated-zzz" });
      expect(out).toContain("No atlas nodes matched");
      expect(out).toContain("00-index.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

```typescript
// src/tools/atlas/lookup.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { ATLAS_INDEX_FILE, ATLAS_ROOT_DIRNAME } from "@/atlas/config";
import { resolveRepoBase } from "@/atlas/repo-url";
import { formatSourceLink } from "@/atlas/source-link";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const SUMMARY_EXCERPT_BYTES = 400;
const FRONTMATTER_DELIMITER = "---";
const SKIP_DIRS = new Set(["_meta", "_archive"]);

const LAYER_BY_DIR: Readonly<Record<string, string>> = {
  "10-impl": "impl",
  "20-behavior": "behavior",
  "30-context": "context",
  "40-decisions": "decision",
  "50-risks": "risk",
  "60-timeline": "timeline",
};

interface ParsedNode {
  readonly absPath: string;
  readonly relPath: string;
  readonly layer: string | null;
  readonly title: string;
  readonly id: string;
  readonly summary: string;
  readonly sources: readonly string[];
  readonly raw: string;
}

const stripFrontmatter = (raw: string): { readonly head: string; readonly body: string } => {
  if (!raw.startsWith(`${FRONTMATTER_DELIMITER}\n`)) return { head: "", body: raw };
  const close = raw.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length + 1);
  if (close === -1) return { head: "", body: raw };
  const head = raw.slice(FRONTMATTER_DELIMITER.length + 1, close);
  const body = raw.slice(close + FRONTMATTER_DELIMITER.length + 2).replace(/^\n/, "");
  return { head, body };
};

const layerFromRelPath = (rel: string): string | null => {
  const top = rel.split(sep)[0] ?? rel.split("/")[0];
  return LAYER_BY_DIR[top] ?? null;
};

const extractH1 = (body: string): string => {
  for (const line of body.split("\n")) {
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return "";
};

const extractSummary = (body: string): string => {
  const lines = body.split("\n");
  let sawH1 = false;
  const out: string[] = [];
  for (const line of lines) {
    if (!sawH1 && line.startsWith("# ")) {
      sawH1 = true;
      continue;
    }
    if (!sawH1) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith("##")) break;
    if (out.length === 0 && trimmed.length === 0) continue;
    if (trimmed.length === 0 && out.length > 0) break;
    out.push(line);
  }
  return out.join("\n").trim();
};

const extractBodyBullets = (body: string, sectionName: string): readonly string[] => {
  const lines = body.split("\n");
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith(`## ${sectionName}`)) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) break;
    if (inSection && line.startsWith("- ")) out.push(line.slice(2).trim());
  }
  return out;
};

const truncateBytes = (text: string, maxBytes: number): string => {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return `${buf.subarray(0, maxBytes).toString("utf8")}…`;
};

const walk = (dir: string, vaultRoot: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, vaultRoot, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    out.push(full);
  }
};

const parseNode = (absPath: string, vaultRoot: string): ParsedNode | null => {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const { body } = stripFrontmatter(raw);
  const relPath = relative(vaultRoot, absPath);
  const id = relPath.replace(/\.md$/u, "").split(sep).join("/");
  const title = extractH1(body) || id;
  return {
    absPath,
    relPath,
    layer: layerFromRelPath(relPath),
    title,
    id,
    summary: extractSummary(body),
    sources: extractBodyBullets(body, "Sources"),
    raw,
  };
};

const matches = (node: ParsedNode, queryLower: string): boolean => {
  if (queryLower.length === 0) return true;
  const haystacks = [node.title, node.id, node.summary, ...node.sources];
  for (const hay of haystacks) {
    if (hay.toLowerCase().includes(queryLower)) return true;
  }
  return false;
};

const renderHit = (node: ParsedNode, repoBase: string): string => {
  const lines = [
    `### ${node.title}`,
    "",
    `- **Path:** \`atlas/${node.relPath}\``,
    `- **Layer:** ${node.layer ?? "unknown"}`,
    `- **Id:** ${node.id}`,
    "",
    "**Summary:**",
    "",
    truncateBytes(node.summary || "_(no summary)_", SUMMARY_EXCERPT_BYTES),
  ];
  if (node.sources.length > 0) {
    lines.push("", "**Sources:**", "");
    for (const src of node.sources) {
      lines.push(`- ${formatSourceLink(src, { repoBase, ref: "main" })}`);
    }
  }
  return lines.join("\n");
};

const renderHits = (hits: readonly ParsedNode[], repoBase: string): string =>
  hits.map((hit) => renderHit(hit, repoBase)).join("\n\n");

interface LookupArgs {
  readonly query: string;
  readonly layer?: string;
  readonly limit?: number;
}

const runLookup = (projectRoot: string, args: LookupArgs): string => {
  const vault = join(projectRoot, ATLAS_ROOT_DIRNAME);
  if (!existsSync(vault)) {
    return [
      "## Atlas not initialized",
      "",
      "There is no `atlas/` directory in this project. Run `/atlas-init` to bootstrap the vault.",
    ].join("\n");
  }
  const indexPath = join(vault, ATLAS_INDEX_FILE);
  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const queryLower = args.query.trim().toLowerCase();
  const layer = args.layer?.trim().toLowerCase() ?? null;

  const files: string[] = [];
  walk(vault, vault, files);
  const nodes: ParsedNode[] = [];
  for (const file of files) {
    if (file === indexPath) continue;
    const parsed = parseNode(file, vault);
    if (parsed === null) continue;
    if (layer !== null && parsed.layer !== layer) continue;
    if (!matches(parsed, queryLower)) continue;
    nodes.push(parsed);
  }
  nodes.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const hits = nodes.slice(0, limit);
  const repoBase = resolveRepoBase(projectRoot);

  if (hits.length === 0) {
    const indexHint = existsSync(indexPath)
      ? "Read `atlas/00-index.md` for a high-level project map, or widen your query / drop the layer filter."
      : "Vault has no `00-index.md` — run `/atlas-init` first.";
    return ["## No atlas nodes matched", "", indexHint].join("\n");
  }

  const header = `## Atlas lookup: ${args.query}${layer === null ? "" : ` (layer=${layer})`}`;
  return `${header}\n\n${renderHits(hits, repoBase)}`;
};

export function createAtlasLookupTool(ctx: PluginInput): { atlas_lookup: ToolDefinition } {
  // Touch statSync so dead-import lints don't strip it; vault walk uses readdir withFileTypes.
  void statSync;
  const atlas_lookup = tool({
    description: `Search the project's atlas/ Obsidian vault for nodes matching a query.
Use this BEFORE running broad codebase searches: atlas summarizes modules, behaviors, decisions, and risks
with stable paths and source links. Returns a markdown summary including title, layer, summary excerpt, and clickable GitHub source links.`,
    args: {
      query: tool.schema.string().describe("Free-text query matched against title, id, summary, sources, connections."),
      layer: tool.schema
        .string()
        .optional()
        .describe("Optional layer filter: impl | behavior | context | decision | risk | timeline."),
      limit: tool.schema
        .number()
        .int()
        .min(1)
        .max(MAX_LIMIT)
        .optional()
        .describe(`Max nodes returned (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
    },
    execute: async ({ query, layer, limit }) => runLookup(ctx.directory, { query, layer, limit }),
  });
  return { atlas_lookup };
}
```

**Verify:** `bun test tests/tools/atlas-lookup.test.ts`
**Commit:** `feat(atlas): add atlas_lookup tool for vault-aware queries`

---

### Task 2.2: Cold-init renderer uses source links and display extras
**File:** `src/atlas/cold-init/renderer.ts`
**Test:** `tests/atlas/cold-init/renderer.test.ts` (extend existing file with new cases; keep existing cases passing)
**Depends:** 1.1, 1.3
**Domain:** general

Existing tests in `tests/atlas/cold-init/renderer.test.ts` MUST stay green. Add the new cases below to the same file (append to the existing `describe("renderColdInitNode", ...)` block).

```typescript
// Append to tests/atlas/cold-init/renderer.test.ts inside the existing describe block.
// Implementer note: the existing 6 tests already use `baseNode` defined at the top of
// the test file. Reuse it. Do NOT delete or rewrite those tests.

  it("renders code: source bullets as GitHub permalinks in body Sources", () => {
    const out = renderColdInitNode({
      node: baseNode,
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
      repoBase: "https://github.com/foo/bar",
    });
    // Body Sources section uses a clickable link; frontmatter sources stay as raw strings.
    expect(out).toContain("[查看源码 src/lifecycle/runner.ts](https://github.com/foo/bar/blob/main/src/lifecycle/runner.ts)");
    expect(out).toContain("- code:src/lifecycle/runner.ts"); // frontmatter list still raw
  });

  it("writes display extras (title, aliases, source_path) into frontmatter", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, title: "Lifecycle 状态机" },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
      repoBase: "https://github.com/foo/bar",
    });
    expect(out).toContain("title: Lifecycle 状态机");
    expect(out).toContain("aliases: 10-impl/runner");
    expect(out).toContain("source_path: src/lifecycle/runner.ts");
  });

  it("preserves non-code source bullets verbatim", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, sources: ["thoughts:shared/designs/x.md", "lifecycle:42"] },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
      repoBase: "https://github.com/foo/bar",
    });
    expect(out).toContain("- thoughts:shared/designs/x.md");
    expect(out).toContain("- lifecycle:42");
    expect(out).not.toContain("blob/main/thoughts");
  });

  it("falls back to ATLAS_REPO_FALLBACK_BASE when no repoBase is supplied", () => {
    const out = renderColdInitNode({
      node: baseNode,
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("https://github.com/Wuxie233/micode/blob/main/src/lifecycle/runner.ts");
  });
```

```typescript
// src/atlas/cold-init/renderer.ts
import type { PlannedNode } from "@/atlas/cold-init/types";
import { deriveDisplayExtras } from "@/atlas/display-extras";
import { serializeFrontmatter } from "@/atlas/frontmatter";
import { ATLAS_REPO_FALLBACK_BASE } from "@/atlas/repo-url";
import { formatSourceLink } from "@/atlas/source-link";
import { ATLAS_NODE_STATUSES, type AtlasFrontmatter } from "@/atlas/types";
import { formatWikilink } from "@/atlas/wikilink";

const EMPTY_PLACEHOLDER = "_无_";
const SUMMARY_PLACEHOLDER = "_摘要待补全：请在下次 lifecycle 或 /atlas-refresh 时补全_";
const INFERRED_PREAMBLE =
  "本页是基于下方来源推断生成的早期草稿，措辞尚未定稿；请在下一次 lifecycle 或 /atlas-refresh 时再核实。";
const DEFAULT_REF = "main";

export interface RenderInput {
  readonly node: PlannedNode;
  readonly userNote: string | null;
  readonly lastVerifiedCommit: string;
  readonly lastWrittenMtime: number;
  readonly repoBase?: string;
}

const renderSection = (title: string, body: string): string => `## ${title}\n\n${body}\n`;

const renderBullets = (items: readonly string[]): string => {
  if (items.length === 0) return EMPTY_PLACEHOLDER;
  return items.map((item) => `- ${item}`).join("\n");
};

const renderSummary = (node: PlannedNode): string => {
  if (!node.inferred) return node.summary;
  return `${INFERRED_PREAMBLE}\n\n${node.summary}`;
};

const buildExtras = (node: PlannedNode): Readonly<Record<string, string>> => {
  const extras = deriveDisplayExtras({ title: node.title, id: node.id, sources: node.sources });
  const out: Record<string, string> = {};
  if (extras.title !== undefined) out.title = extras.title;
  if (extras.aliases !== undefined) out.aliases = extras.aliases;
  if (extras.source_path !== undefined) out.source_path = extras.source_path;
  return out;
};

const renderSourceBody = (sources: readonly string[], repoBase: string): string => {
  if (sources.length === 0) return EMPTY_PLACEHOLDER;
  const ref = DEFAULT_REF;
  return sources.map((src) => `- ${formatSourceLink(src, { repoBase, ref })}`).join("\n");
};

export function renderColdInitNode(input: RenderInput): string {
  const repoBase = input.repoBase ?? ATLAS_REPO_FALLBACK_BASE;
  const frontmatter: AtlasFrontmatter = {
    id: input.node.id,
    layer: input.node.layer,
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: input.lastVerifiedCommit,
    last_written_mtime: input.lastWrittenMtime,
    sources: input.node.sources,
    extras: buildExtras(input.node),
  };
  const summary = renderSummary(input.node) || SUMMARY_PLACEHOLDER;
  const sections: string[] = [`# ${input.node.title}\n`, renderSection("Summary", summary)];
  const note = input.userNote?.trim();
  if (note) sections.push(renderSection("User notes", note));
  sections.push(renderSection("Connections", renderBullets(input.node.connections.map(formatWikilink))));
  sections.push(renderSection("Sources", renderSourceBody(input.node.sources, repoBase)));
  sections.push(renderSection("Notes", EMPTY_PLACEHOLDER));
  return serializeFrontmatter(frontmatter, sections.join("\n"));
}
```

**Note for caller (`src/atlas/cold-init/vault-writer.ts`):** the writer currently calls `renderColdInitNode` without `repoBase`. The new param is optional and defaults to `ATLAS_REPO_FALLBACK_BASE`, so the writer keeps compiling unchanged. A follow-up pass (out-of-scope for this issue) should thread `resolveRepoBase(projectRoot)` from `writeVault` into `renderColdInitNode` for accurate per-project URLs.

**Verify:** `bun test tests/atlas/cold-init/renderer.test.ts`
**Commit:** `feat(atlas): render cold-init Sources as permalinks with display extras`

---

### Task 2.3: Templates use source links and display extras
**File:** `src/atlas/templates.ts`
**Test:** `tests/atlas/templates.test.ts` (extend existing file)
**Depends:** 1.1, 1.3
**Domain:** general

Existing `tests/atlas/templates.test.ts` MUST keep passing. Add the new cases below to the existing describe block(s).

```typescript
// Append to tests/atlas/templates.test.ts.
// Reuse imports already present in that file: renderEmptyNode, renderPhaseRoadmap, ATLAS_NODE_STATUSES.

  it("renderEmptyNode: body Sources renders code: pointers as GitHub permalinks", () => {
    const out = renderEmptyNode({
      id: "10-impl/x",
      layer: "impl",
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "summary",
      sources: ["code:src/x.ts"],
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
      repoBase: "https://github.com/foo/bar",
    });
    expect(out).toContain("[查看源码 src/x.ts](https://github.com/foo/bar/blob/main/src/x.ts)");
    // Frontmatter sources stay raw.
    expect(out).toContain("  - code:src/x.ts");
  });

  it("renderEmptyNode: writes title/aliases/source_path into frontmatter extras", () => {
    const out = renderEmptyNode({
      id: "10-impl/x",
      layer: "impl",
      status: ATLAS_NODE_STATUSES.ACTIVE,
      title: "X 模块",
      summary: "s",
      sources: ["code:src/x.ts"],
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("title: X 模块");
    expect(out).toContain("aliases: 10-impl/x");
    expect(out).toContain("source_path: src/x.ts");
  });

  it("renderEmptyNode: backward compatible — works without title or repoBase", () => {
    const out = renderEmptyNode({
      id: "10-impl/x",
      layer: "impl",
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "s",
      sources: [],
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    // No title key emitted when title is absent; aliases still written from id.
    expect(out).not.toMatch(/^title:/m);
    expect(out).toContain("aliases: 10-impl/x");
  });
```

```typescript
// src/atlas/templates.ts
import { deriveDisplayExtras } from "./display-extras";
import { serializeFrontmatter } from "./frontmatter";
import { ATLAS_REPO_FALLBACK_BASE } from "./repo-url";
import { formatSourceLink } from "./source-link";
import { ATLAS_NODE_STATUSES, type AtlasFrontmatter, type AtlasLayer, type AtlasNodeStatus } from "./types";

const DEFAULT_REF = "main";

interface EmptyNodeInput {
  readonly id: string;
  readonly layer: AtlasLayer;
  readonly status: AtlasNodeStatus;
  readonly title?: string;
  readonly summary: string;
  readonly sources: readonly string[];
  readonly lastVerifiedCommit: string;
  readonly lastWrittenMtime: number;
  readonly connections?: readonly string[];
  readonly repoBase?: string;
}

const renderH2 = (title: string, body: string): string => `## ${title}\n\n${body}\n`;
const bullet = (items: readonly string[]): string =>
  items.length === 0 ? "_none_" : items.map((s) => `- ${s}`).join("\n");

const renderSourcesBody = (sources: readonly string[], repoBase: string): string => {
  if (sources.length === 0) return "_none_";
  const ref = DEFAULT_REF;
  return sources.map((src) => `- ${formatSourceLink(src, { repoBase, ref })}`).join("\n");
};

const buildExtras = (input: EmptyNodeInput): Readonly<Record<string, string>> => {
  const titleForExtras = input.title ?? "";
  const extras = deriveDisplayExtras({ title: titleForExtras, id: input.id, sources: input.sources });
  const out: Record<string, string> = {};
  if (extras.title !== undefined) out.title = extras.title;
  if (extras.aliases !== undefined) out.aliases = extras.aliases;
  if (extras.source_path !== undefined) out.source_path = extras.source_path;
  return out;
};

export function renderEmptyNode(input: EmptyNodeInput): string {
  const repoBase = input.repoBase ?? ATLAS_REPO_FALLBACK_BASE;
  const fm: AtlasFrontmatter = {
    id: input.id,
    layer: input.layer,
    status: input.status,
    last_verified_commit: input.lastVerifiedCommit,
    last_written_mtime: input.lastWrittenMtime,
    sources: input.sources,
    extras: buildExtras(input),
  };
  const heading = input.title ? `# ${input.title}\n\n` : "";
  const body = [
    heading + renderH2("Summary", input.summary),
    renderH2("Connections", bullet(input.connections ?? [])),
    renderH2("Sources", renderSourcesBody(input.sources, repoBase)),
    renderH2("Notes", "_none_"),
  ].join("\n");
  return serializeFrontmatter(fm, body);
}

export function renderIndexPage(input: { readonly projectName: string }): string {
  const fm: AtlasFrontmatter = {
    id: "index",
    layer: "decision",
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: "",
    last_written_mtime: 0,
    sources: [],
    extras: {},
  };
  const body = [
    `# ${input.projectName}\n`,
    "Project Atlas is a curated map maintained by humans and agents together.\n",
    "agent2 refreshes the impl, decision, risk, and timeline layers after lifecycle finish.\n",
    "Open `_meta/challenges/` to review proposed changes that touch your edits.\n",
    renderH2("Summary", "_human-authored intro goes here_"),
    renderH2("Reading guide", "Build layer at `10-impl/`. Behavior layer at `20-behavior/`."),
  ].join("\n");
  return serializeFrontmatter(fm, body);
}

export function renderPhaseRoadmap(): string {
  const fm: AtlasFrontmatter = {
    id: "decision/atlas-phase-roadmap",
    layer: "decision",
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: "",
    last_written_mtime: 0,
    sources: ["thoughts:shared/designs/2026-05-04-project-atlas-design.md"],
    extras: {},
  };
  const body = [
    "## Summary\n\nCanonical record of what is in scope for Phase 2 and what is deferred to Phase 3.\n",
    "## Connections\n\n_none_\n",
    "## Sources\n\n- thoughts:shared/designs/2026-05-04-project-atlas-design.md\n",
    "## Notes\n",
    "### Phase 2: Closed-loop integration (delivered)\n",
    "Lifecycle finish auto-spawn of agent2; structured handoff; spawn receipt; worker fan-out;",
    "atomic write protocol; mtime-based edit detection; challenge flow with dedup and cooldown;",
    "wikilink rewiring constraint; soft delete to `_archive/`; first-person maintenance log;",
    "`/atlas-status`; `/atlas-init --reconcile` and `--force-rebuild`; `atlas:` commit prefix;",
    "`/atlas-init` is a comprehensive cold-start orchestrator independent of lifecycle handoff;",
    "User Perspective lifecycle enforcement; schema version file at `_meta/schema-version`.\n",
    "### Phase 3: Hardening and operational maturity (deferred)\n",
    "Independent lint and GC pass; project type profile system; agent2 failure escalation;",
    "cross-project schema migration tools; independent git isolation; madge/dep-cruiser SVG;",
    "Behavior layer round-trip verification.",
  ].join("\n");
  return serializeFrontmatter(fm, body);
}
```

**Verify:** `bun test tests/atlas/templates.test.ts`
**Commit:** `feat(atlas): templates render source links and display extras`

---

### Task 2.4: atlas-translator prompt extension
**File:** `src/agents/atlas-translator.ts`
**Test:** `tests/agents/atlas-translator.test.ts` (extend existing file)
**Depends:** none (prompt-only change; semantic risk is low — Test field would normally be "none", but existing tests already assert prompt content, so we extend the existing test file with new assertions for the new responsibilities; no new test FILE is added)
**Domain:** general

Append the following new cases to `tests/agents/atlas-translator.test.ts`. Existing cases must stay green.

```typescript
// Append to tests/agents/atlas-translator.test.ts inside the
// describe("atlas-translator agent config", ...) block.

  it("instructs translator to inject display metadata into frontmatter extras", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toContain("title");
    expect(p).toContain("aliases");
    expect(p).toContain("source_path");
    expect(p).toContain("extras");
    // Must not rename files or change wikilink targets.
    expect(p.toLowerCase()).toContain("do not rename");
  });

  it("instructs translator to rewrite Sources body bullets to GitHub permalinks", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toContain("查看源码");
    expect(p).toContain("github.com");
    expect(p).toContain("blob/");
    // Must keep frontmatter sources list as raw pointer strings.
    expect(p.toLowerCase()).toContain("frontmatter sources");
    expect(p.toLowerCase()).toContain("raw");
  });

  it("instructs translator to skip code: pointers it cannot parse", () => {
    const p = atlasTranslatorAgent.prompt.toLowerCase();
    expect(p).toContain("preserve the original bullet");
  });
```

For the prompt change itself, modify the existing `PROMPT` constant in `src/agents/atlas-translator.ts`. Keep the existing structure (identity, critical-rules, target-scope, execution-plan, log-template, rules, auto-commit). Add a NEW `<display-metadata>` section AFTER the existing `<section-heading-translation-guide>` and BEFORE `<target-scope>`, AND add a NEW `<source-link-rewrite>` section in the same location. Add two new rules under `<critical-rules>`. Do NOT remove or rewrite any existing rule.

Concretely, the implementer should make the following edits inside `PROMPT`:

1. Inside `<critical-rules>`, append (immediately before `</critical-rules>`):

```xml
    <rule>DO NOT rename files or change wikilink targets. File paths and [[Target Name]] strings are stable machine identifiers.</rule>
    <rule>DO NOT change the frontmatter `sources:` list — those are raw pointer strings consumed by reconciler/workers/parser. Only the body Sources section is rewritten.</rule>
    <rule>WRITE display extras into frontmatter when a node has none: add `title` (Chinese display name), `aliases` (the original English id, so wikilinks keep resolving), and `source_path` (the first `code:src/...` pointer's path, with any line anchor stripped). Keep them as plain `key: value` lines under the existing required keys.</rule>
    <rule>REWRITE body `## Sources` bullets that begin with `code:src/...` into clickable GitHub permalinks of the form `[查看源码 <path>](<repoBase>/blob/main/<path>)`. The repoBase is read from `package.json#repository.url` (or `git remote get-url origin`); if neither is parseable, fall back to `https://github.com/Wuxie233/micode`. Non-`code:` bullets (lifecycle:N, thoughts:..., pm:..., mindmodel:...) and bullets that are not parseable pointers MUST preserve the original bullet verbatim.</rule>
```

2. After `</section-heading-translation-guide>` and before `<target-scope>`, insert two new sections:

```xml
  <display-metadata>
    Some existing nodes were generated before display metadata was added. When you encounter a node whose
    frontmatter has neither `title` nor `aliases` nor `source_path`, ADD them while you are translating that
    node:

    - `title`: Chinese display name. Use the H1 heading text (translated) as the seed.
    - `aliases`: the node's stable English id. For nodes generated by cold-init this is the relative path
      without `.md`, e.g. `10-impl/lifecycle-state-machine`. If the node has an `id:` field already, copy
      it. Aliases keeps wikilinks resolving when the `obsidian-front-matter-title` plugin overrides the
      visible label.
    - `source_path`: the first `code:src/...` pointer's path with any `#L...` line anchor removed, e.g.
      `code:src/lifecycle/runner.ts#L10` → `src/lifecycle/runner.ts`. Omit this key entirely if the node
      has no `code:` source.

    Insert these as plain `key: value` lines in the frontmatter block, between the required machine keys
    and the `sources:` list. Do not turn them into a nested `extras:` map; the parser stores them in
    `extras` automatically by virtue of being non-required keys.

    If a node already has any of these three keys, leave that key unchanged.
  </display-metadata>

  <source-link-rewrite>
    Inside the body `## Sources` section (NOT the frontmatter `sources:` list), every bullet that starts
    with `code:src/...` MUST be rewritten to a clickable GitHub permalink:

    - Original: `- code:src/lifecycle/runner.ts`
    - Rewritten: `- [查看源码 src/lifecycle/runner.ts](<repoBase>/blob/main/src/lifecycle/runner.ts)`

    Where `<repoBase>` is the project's GitHub repo URL without `.git` and without a trailing slash.
    Discover it from `package.json#repository.url` (run `cat package.json` or read the file directly);
    fall back to running `git remote get-url origin` and stripping `.git`; if neither works fall back to
    `https://github.com/Wuxie233/micode`.

    Bullets that are not `code:` pointers (`lifecycle:N`, `thoughts:...`, `pm:...`, `mindmodel:...`) or
    bullets that are not parseable as a pointer at all (free text) MUST preserve the original bullet
    verbatim — do NOT generate broken links.

    The frontmatter `sources:` list is the machine identifier list; it stays as raw pointer strings and
    is never rewritten. Only the body Sources section bullets are touched.
  </source-link-rewrite>
```

The implementer should verify the resulting prompt still parses (it is plain XML-flavored text inside a JS template literal) and that all existing tests in `tests/agents/atlas-translator.test.ts` still pass alongside the new ones.

**Verify:** `bun test tests/agents/atlas-translator.test.ts`
**Commit:** `feat(atlas): translator injects display metadata and rewrites Sources to permalinks`

---

### Task 2.5: Export atlas_lookup factory from atlas tools barrel
**File:** `src/tools/atlas/index.ts`
**Test:** none (re-export glue; semantic risk low; the integration test in 2.1 already covers behavior)
**Depends:** 2.1
**Domain:** general

Replace the current barrel with the version below. The change is additive — all existing exports stay.

```typescript
// src/tools/atlas/index.ts
export { runAtlasInit } from "./init";
export { createAtlasLookupTool } from "./lookup";
export { runAtlasRefresh } from "./refresh";
export { runAtlasStatus } from "./status";
```

**Verify:** `bun run typecheck`
**Commit:** `feat(atlas): export createAtlasLookupTool from atlas tools barrel`

---

## Batch 3: Registration (sequential - 2 implementers)

All tasks in this batch depend on Batch 2 completing. 3.2 imports the factory re-exported by 3.1, so they are sequential within this batch.
Tasks: 3.1, 3.2

### Task 3.1: Re-export createAtlasLookupTool from src/tools barrel
**File:** `src/tools/index.ts`
**Test:** none (re-export glue; behavior is exercised by Task 2.1's tool tests and Task 3.2's integration)
**Depends:** 2.5
**Domain:** general

Add a single new export line to the existing barrel. All existing exports stay.

```typescript
// src/tools/index.ts
export { artifact_search } from "./artifact-search";
export { ast_grep_replace, ast_grep_search, checkAstGrepAvailable } from "./ast-grep";
export { createAtlasLookupTool } from "./atlas";
export { createBatchReadTool } from "./batch-read";
export { btca_ask, checkBtcaAvailable } from "./btca";
export { look_at } from "./look-at";
export { milestone_artifact_search } from "./milestone-artifact-search";
export { createMindmodelLookupTool } from "./mindmodel-lookup";
export { createOcttoTools, createSessionStore } from "./octto";
export {
  createProjectMemoryForgetTool,
  createProjectMemoryHealthTool,
  createProjectMemoryLookupTool,
  createProjectMemoryPromoteTool,
} from "./project-memory";
export { createPTYManager, createPtyTools, loadBunPty } from "./pty";
export { createSpawnAgentTool } from "./spawn-agent";
```

**Verify:** `bun run typecheck`
**Commit:** `feat(atlas): re-export createAtlasLookupTool from tools barrel`

---

### Task 3.2: Register atlas_lookup tool in plugin
**File:** `src/index.ts`
**Test:** `tests/integration/atlas-lookup-registration.test.ts`
**Depends:** 3.1
**Domain:** general

```typescript
// tests/integration/atlas-lookup-registration.test.ts
import { describe, expect, it } from "bun:test";

import { createAtlasLookupTool } from "@/tools";

describe("atlas_lookup tool registration surface", () => {
  it("createAtlasLookupTool is exported from @/tools", () => {
    expect(typeof createAtlasLookupTool).toBe("function");
  });

  it("returns a tool definition keyed by atlas_lookup", () => {
    const ctx = { directory: process.cwd() } as Parameters<typeof createAtlasLookupTool>[0];
    const tools = createAtlasLookupTool(ctx);
    expect(tools.atlas_lookup).toBeDefined();
    expect(typeof tools.atlas_lookup.execute).toBe("function");
    expect(typeof tools.atlas_lookup.description).toBe("string");
    expect((tools.atlas_lookup.description as string).toLowerCase()).toContain("atlas");
  });

  it("includes layer and limit args", () => {
    const ctx = { directory: process.cwd() } as Parameters<typeof createAtlasLookupTool>[0];
    const { atlas_lookup } = createAtlasLookupTool(ctx);
    const args = atlas_lookup.args as Record<string, unknown>;
    expect(args.query).toBeDefined();
    expect(args.layer).toBeDefined();
    expect(args.limit).toBeDefined();
  });
});
```

For `src/index.ts` itself, make exactly two minimal edits:

1. Add `createAtlasLookupTool` to the import block from `@/tools`. The current block is:

```typescript
import {
  artifact_search,
  ast_grep_replace,
  ast_grep_search,
  btca_ask,
  checkAstGrepAvailable,
  checkBtcaAvailable,
  createBatchReadTool,
  createMindmodelLookupTool,
  createOcttoTools,
  createProjectMemoryForgetTool,
  createProjectMemoryHealthTool,
  createProjectMemoryLookupTool,
  createProjectMemoryPromoteTool,
  createPTYManager,
  createPtyTools,
  createSessionStore,
  loadBunPty,
  look_at,
  milestone_artifact_search,
} from "@/tools";
```

Replace with (one new identifier, alphabetically placed; everything else stays byte-for-byte):

```typescript
import {
  artifact_search,
  ast_grep_replace,
  ast_grep_search,
  btca_ask,
  checkAstGrepAvailable,
  checkBtcaAvailable,
  createAtlasLookupTool,
  createBatchReadTool,
  createMindmodelLookupTool,
  createOcttoTools,
  createProjectMemoryForgetTool,
  createProjectMemoryHealthTool,
  createProjectMemoryLookupTool,
  createProjectMemoryPromoteTool,
  createPTYManager,
  createPtyTools,
  createSessionStore,
  loadBunPty,
  look_at,
  milestone_artifact_search,
} from "@/tools";
```

2. Instantiate the tool inside the plugin factory and spread it into the returned `tool` map. Locate the existing line near the mindmodel tool wiring:

```typescript
  // Mindmodel lookup tool - agents call this when they need coding patterns
  const mindmodelLookupTool = createMindmodelLookupTool(ctx);
```

Add immediately after it:

```typescript
  // Atlas lookup tool - agents call this BEFORE broad codebase searches to consult atlas/
  const atlasLookupTool = createAtlasLookupTool(ctx);
```

Then in the returned `tool` map (the object inside `return { tool: { ... }, ... }` near the bottom of the plugin factory), add `...atlasLookupTool` next to the existing `...mindmodelLookupTool`:

```typescript
    tool: {
      ast_grep_search,
      ast_grep_replace,
      btca_ask,
      look_at,
      artifact_search,
      milestone_artifact_search,
      spawn_agent,
      resume_subagent,
      cleanup_parent_run,
      batch_read,
      ...atlasLookupTool,
      ...mindmodelLookupTool,
      ...projectMemoryTools,
      ...ptyTools,
      ...octtoTools,
      ...lifecycleTools,
    },
```

These are the ONLY edits to `src/index.ts`. Do not touch any other line. The plugin's `ctx` parameter is in scope and is the same `PluginInput` instance used by `createMindmodelLookupTool(ctx)` — `createAtlasLookupTool` only uses `ctx.directory` (the same surface mindmodel uses).

**Verify:** `bun test tests/integration/atlas-lookup-registration.test.ts && bun run typecheck`
**Commit:** `feat(atlas): register atlas_lookup tool in plugin`
