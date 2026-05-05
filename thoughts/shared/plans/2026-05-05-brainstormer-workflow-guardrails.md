---
date: 2026-05-05
topic: "Brainstormer workflow guardrails"
issue: 40
scope: lifecycle
contract: none
---

# Brainstormer Workflow Guardrails Implementation Plan

**Goal:** Harden lifecycle pre-flight to resolve the GitHub target from `origin` (not bare `gh repo view`) and tighten the brainstormer prompt so non-trivial workflow/runtime/agent/lifecycle work cannot be downgraded into `executor-direct`.

**Architecture:** Two focused changes in two independent files. (1) `src/lifecycle/pre-flight.ts` parses the origin URL into an explicit `owner/repo` slug, then queries GitHub CLI with that slug as a positional argument, eliminating the implicit `upstream`-wins behavior. (2) `src/agents/brainstormer.ts` adds a high-priority non-trivial detector and a forbidden-routes block so agent/slash-command/runtime/deploy/workflow/lifecycle/cross-module surfaces are explicitly denied from `executor-direct`. Both changes are pure data/config (no business logic surface area), tested via existing fake-runner pattern and prompt-contract regex assertions.

**Design:** [thoughts/shared/designs/2026-05-05-brainstormer-workflow-guardrails-design.md](../designs/2026-05-05-brainstormer-workflow-guardrails-design.md)

**Contract:** none (single-domain plan; both tasks are `Domain: general`)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [both touch independent files - no cross-deps]
```

The two tasks modify entirely separate files (`src/lifecycle/pre-flight.ts` and `src/agents/brainstormer.ts`) and import nothing from each other. They run concurrently.

---

## Batch 1: Workflow Guardrails (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Lifecycle pre-flight resolves repo from explicit origin slug
**File:** `src/lifecycle/pre-flight.ts`
**Test:** `tests/lifecycle/pre-flight.test.ts`
**Depends:** none
**Domain:** general

**Implementation decisions (gap-filling from design):**
- The design says "extract the GitHub slug from `origin`" and "query that exact slug with GitHub CLI." I'm implementing slug parsing with a single regex that handles both SSH (`git@github.com:owner/repo.git`) and HTTPS (`https://github.com/owner/repo[.git]`) forms, plus an explicit reject for hosts other than `github.com`. Non-GitHub origins return `kind: UNKNOWN` immediately, before any `gh` invocation, because lifecycle has no meaning off GitHub.
- The new GitHub CLI call uses `gh repo view <owner/repo> --json ...` (positional repo argument). This is the documented way to bypass GitHub CLI's directory-based remote inference, which is what made `upstream` win when both remotes existed.
- Fail-closed semantics: if the origin cannot be parsed into a slug, return `UNKNOWN` with the raw origin preserved; the caller already short-circuits on `UNKNOWN`.
- The `nameWithOwner` returned by `gh` is still trusted for classification (it is the canonical case-corrected form), but the slug we *passed in* is the safety boundary. We do not need to assert equality between the two: `gh` may legitimately normalize case, and any deeper mismatch (host redirect, deleted+recreated repo) is out of scope for this lifecycle.
- Existing tests must keep passing. The existing fake-runner asserts `gh` was called with `["repo", "view", "--json", GH_FIELDS]`; we must update those assertions to include the new positional slug argument, e.g. `["repo", "view", "Wuxie233/micode", "--json", GH_FIELDS]`. This is explicitly part of the test diff.

**Test code (extends existing file: add the new fork+upstream regression block AND update the existing `expectCalls` helper to include the slug positional):**

```typescript
// tests/lifecycle/pre-flight.test.ts
// REPLACE the existing GH_ARGS constant and expectCalls helper with these:

const GH_ARGS = ["repo", "view", REPO, "--json", GH_FIELDS] as const;

const expectCalls = (runner: FakeRunner): void => {
  expect(runner.calls).toEqual([
    { bin: "git", args: GIT_ARGS, cwd: CWD },
    { bin: "gh", args: GH_ARGS, cwd: CWD },
  ]);
};

// ADD these new tests INSIDE the existing `describe("classifyRepo", ...)` block,
// AFTER the existing "returns unknown when ownership commands fail" test:

it("passes origin-derived slug as positional argument to gh repo view", async () => {
  const runner = createRunner({
    gh: createRun(createRepoView({ isFork: true, parent: { name: PARENT_NAME, owner: { login: PARENT_OWNER } } })),
  });

  await classifyRepo(runner, CWD);

  const ghCall = runner.calls.find((call) => call.bin === "gh");
  expect(ghCall).toBeDefined();
  expect(ghCall?.args).toEqual(["repo", "view", REPO, "--json", GH_FIELDS]);
});

it("parses HTTPS origin URL and queries the matching slug", async () => {
  const httpsOrigin = `https://github.com/${REPO}.git\n`;
  const runner = createRunner({
    git: createRun(httpsOrigin),
    gh: createRun(createRepoView({ isFork: true, parent: { name: PARENT_NAME, owner: { login: PARENT_OWNER } } })),
  });

  const preflight = await classifyRepo(runner, CWD);

  expect(preflight.kind).toBe(REPO_KIND.FORK);
  const ghCall = runner.calls.find((call) => call.bin === "gh");
  expect(ghCall?.args).toEqual(["repo", "view", REPO, "--json", GH_FIELDS]);
});

it("parses HTTPS origin URL without trailing .git", async () => {
  const httpsOrigin = `https://github.com/${REPO}\n`;
  const runner = createRunner({
    git: createRun(httpsOrigin),
    gh: createRun(createRepoView({ isFork: true, parent: { name: PARENT_NAME, owner: { login: PARENT_OWNER } } })),
  });

  const preflight = await classifyRepo(runner, CWD);

  expect(preflight.kind).toBe(REPO_KIND.FORK);
  const ghCall = runner.calls.find((call) => call.bin === "gh");
  expect(ghCall?.args).toEqual(["repo", "view", REPO, "--json", GH_FIELDS]);
});

it("regression: fork with upstream remote still classifies as FORK against origin slug, not upstream", async () => {
  // The bug: bare `gh repo view` resolved to upstream (vtemian/micode) when both
  // origin (Wuxie233/micode) and upstream (vtemian/micode) remotes existed.
  // The fix: we query gh with the exact origin slug, so upstream existence is irrelevant.
  const runner = createRunner({
    gh: createRun(REAL_GH_REPO_VIEW),
  });

  const preflight = await classifyRepo(runner, CWD);

  expect(preflight.kind).toBe(REPO_KIND.FORK);
  expect(preflight.nameWithOwner).toBe(REPO);
  expect(preflight.viewerLogin).toBe(OWNER);
  expect(preflight.upstreamUrl).toBe(PARENT_URL);
  // Critical assertion: gh was called with origin's slug, not bare.
  const ghCall = runner.calls.find((call) => call.bin === "gh");
  expect(ghCall?.args).toEqual(["repo", "view", REPO, "--json", GH_FIELDS]);
});

it("returns unknown when origin URL cannot be parsed as github.com slug", async () => {
  const nonGithubOrigin = "git@gitlab.example.com:other/repo.git\n";
  const runner = createRunner({ git: createRun(nonGithubOrigin) });

  const preflight = await classifyRepo(runner, CWD);

  expect(preflight.kind).toBe(REPO_KIND.UNKNOWN);
  expect(preflight.origin).toBe(nonGithubOrigin.trim());
  // gh must NOT be invoked when origin is unparseable: fail-closed.
  expect(runner.calls.some((call) => call.bin === "gh")).toBe(false);
});

it("returns unknown when origin is empty after trim", async () => {
  const runner = createRunner({ git: createRun("\n") });

  const preflight = await classifyRepo(runner, CWD);

  expect(preflight.kind).toBe(REPO_KIND.UNKNOWN);
  expect(runner.calls.some((call) => call.bin === "gh")).toBe(false);
});
```

**Implementation code (full replacement of `src/lifecycle/pre-flight.ts`):**

```typescript
import * as v from "valibot";

import type { LifecycleRunner, RunResult } from "./runner";

export const REPO_KIND = {
  FORK: "fork",
  OWN: "own",
  UPSTREAM: "upstream",
  UNKNOWN: "unknown",
} as const;

export type RepoKind = (typeof REPO_KIND)[keyof typeof REPO_KIND];

export interface PreFlightResult {
  readonly kind: RepoKind;
  readonly origin: string;
  readonly nameWithOwner: string;
  readonly viewerLogin: string | null;
  readonly issuesEnabled: boolean;
  readonly upstreamUrl: string | null;
}

const OK_EXIT_CODE = 0;
const EMPTY_OUTPUT = "";
const GITHUB_REPO_BASE_URL = "https://github.com";
const GIT_ORIGIN_ARGS = ["remote", "get-url", "origin"] as const;
const GH_FIELDS = "nameWithOwner,isFork,parent,owner,viewerPermission,hasIssuesEnabled";
const OWNER_PERMISSIONS: readonly string[] = ["ADMIN", "MAINTAIN", "WRITE"];

// Matches:
//   git@github.com:owner/repo.git
//   git@github.com:owner/repo
//   https://github.com/owner/repo.git
//   https://github.com/owner/repo
//   ssh://git@github.com/owner/repo.git
const GITHUB_ORIGIN_PATTERN = /^(?:git@github\.com:|(?:https?|ssh):\/\/(?:[^@]+@)?github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/;

const buildGhRepoArgs = (slug: string): readonly string[] => ["repo", "view", slug, "--json", GH_FIELDS];

interface RepoParent {
  readonly nameWithOwner: string;
  readonly url?: string;
}

interface RepoViewInput {
  readonly nameWithOwner: string;
  readonly isFork: boolean;
  readonly parent: unknown;
  readonly owner: {
    readonly login: string;
  };
  readonly viewerPermission: string;
  readonly hasIssuesEnabled: boolean;
}

interface RepoView {
  readonly nameWithOwner: string;
  readonly isFork: boolean;
  readonly parent: RepoParent | null;
  readonly owner: {
    readonly login: string;
  };
  readonly viewerPermission: string;
  readonly hasIssuesEnabled: boolean;
}

const LegacyRepoParentSchema = v.object({
  nameWithOwner: v.string(),
  url: v.optional(v.string()),
});

const GhRepoParentSchema = v.object({
  name: v.string(),
  owner: v.object({ login: v.string() }),
  url: v.optional(v.string()),
});

const RepoParentSchema = v.union([LegacyRepoParentSchema, GhRepoParentSchema]);

const RepoViewSchema: v.GenericSchema<unknown, RepoViewInput> = v.object({
  nameWithOwner: v.string(),
  isFork: v.boolean(),
  parent: v.nullable(v.unknown()),
  owner: v.object({ login: v.string() }),
  viewerPermission: v.string(),
  hasIssuesEnabled: v.boolean(),
});

type LegacyRepoParent = v.InferOutput<typeof LegacyRepoParentSchema>;
type ParsedRepoParent = v.InferOutput<typeof RepoParentSchema>;

const createUnknown = (origin = EMPTY_OUTPUT): PreFlightResult => ({
  kind: REPO_KIND.UNKNOWN,
  origin,
  nameWithOwner: EMPTY_OUTPUT,
  viewerLogin: null,
  issuesEnabled: false,
  upstreamUrl: null,
});

const completed = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const parseOriginSlug = (origin: string): string | null => {
  const trimmed = origin.trim();
  if (trimmed === EMPTY_OUTPUT) return null;
  const match = trimmed.match(GITHUB_ORIGIN_PATTERN);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
};

const createParent = (nameWithOwner: string, url?: string): RepoParent => {
  if (url === undefined) return { nameWithOwner };
  return { nameWithOwner, url };
};

const isLegacyParent = (parent: ParsedRepoParent): parent is LegacyRepoParent => "nameWithOwner" in parent;

const normalizeParent = (parent: unknown): RepoParent | null => {
  if (parent === null) return null;

  const parsed = v.safeParse(RepoParentSchema, parent);
  if (!parsed.success) return null;
  if (isLegacyParent(parsed.output)) return createParent(parsed.output.nameWithOwner, parsed.output.url);

  return createParent(`${parsed.output.owner.login}/${parsed.output.name}`, parsed.output.url);
};

const normalizeView = (view: RepoViewInput): RepoView => ({
  nameWithOwner: view.nameWithOwner,
  isFork: view.isFork,
  parent: normalizeParent(view.parent),
  owner: view.owner,
  viewerPermission: view.viewerPermission,
  hasIssuesEnabled: view.hasIssuesEnabled,
});

const parseRepoView = (stdout: string): RepoView | null => {
  try {
    const raw: unknown = JSON.parse(stdout);
    const parsed = v.safeParse(RepoViewSchema, raw);
    if (parsed.success) return normalizeView(parsed.output);
    return null;
  } catch {
    // Invalid JSON means pre-flight cannot trust ownership metadata.
    return null;
  }
};

const isOwned = (permission: string): boolean => OWNER_PERMISSIONS.includes(permission);

const classifyView = (view: RepoView): RepoKind => {
  if (view.isFork) return REPO_KIND.FORK;
  if (isOwned(view.viewerPermission)) return REPO_KIND.OWN;
  return REPO_KIND.UPSTREAM;
};

const getParentUrl = (parent: RepoParent | null): string | null => {
  if (!parent) return null;
  if (parent.url) return parent.url;
  return `${GITHUB_REPO_BASE_URL}/${parent.nameWithOwner}`;
};

const createResult = (origin: string, view: RepoView): PreFlightResult => {
  const kind = classifyView(view);

  return {
    kind,
    origin,
    nameWithOwner: view.nameWithOwner,
    viewerLogin: kind === REPO_KIND.UPSTREAM ? null : view.owner.login,
    issuesEnabled: view.hasIssuesEnabled,
    upstreamUrl: getParentUrl(view.parent),
  };
};

export async function classifyRepo(runner: LifecycleRunner, cwd: string): Promise<PreFlightResult> {
  const remote = await runner.git(GIT_ORIGIN_ARGS, { cwd });
  if (!completed(remote)) return createUnknown();

  const origin = remote.stdout.trim();
  const slug = parseOriginSlug(origin);
  if (!slug) return createUnknown(origin);

  const inspected = await runner.gh(buildGhRepoArgs(slug), { cwd });
  if (!completed(inspected)) return createUnknown(origin);

  const view = parseRepoView(inspected.stdout);
  if (!view) return createUnknown(origin);

  return createResult(origin, view);
}
```

**Verify:** `bun test tests/lifecycle/pre-flight.test.ts`
**Commit:** `fix(lifecycle): resolve gh target from origin slug to defeat upstream remote shadowing`

---

### Task 1.2: Brainstormer prompt forbids executor-direct for non-trivial workflow surfaces
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/brainstormer.test.ts`
**Depends:** none
**Domain:** general

**Implementation decisions (gap-filling from design):**
- The design says "high-priority non-trivial task detector" and "explicit forbidden routes for `executor-direct`" but does not prescribe a specific XML shape. I'm adding a single new top-level block `<non-trivial-detector priority="HIGHEST">` that lists the forbidden surfaces and forces lifecycle routing, placed immediately after `<critical-rules>` and before `<routing-by-requested-output>` so it is read before any routing decision.
- The forbidden surfaces (per user constraint): agent files, slash commands, runtime behavior, deploy/release, workflow/lifecycle infrastructure, cross-module features. These map to concrete repo touchpoints: `src/agents/**`, `src/index.ts` slash command registrations, anything under `src/lifecycle/**`, `src/hooks/**`, `bun run deploy:runtime` flows, and any change spanning two or more `src/<module>/` directories.
- I extend the existing `<output-class name="direct-execution" agent="executor-direct">` body with a `<forbidden-for>` sub-list so the routing block itself documents what it cannot accept. This avoids divergence between the high-priority detector and the routing class doc.
- I keep the existing direct-execution language for legitimate quick-mode (typo, single-line patch, local op) intact: the design explicitly preserves trivial-task quick-mode.
- I do NOT touch any other agent (commander, executor-direct itself, octto). The cross-coordinator routing test (`tests/agents/executor-direct-routing.test.ts`) must keep passing because the routing class names and agent names do not change. New tests are added to `tests/agents/brainstormer.test.ts` that prompt-contract-assert the new block.

**Test code (additions to existing `tests/agents/brainstormer.test.ts`; DO NOT delete existing tests):**

```typescript
// tests/agents/brainstormer.test.ts
// ADD a new describe block at the end of the file:

describe("brainstormer non-trivial detector guardrails", () => {
  it("declares a high-priority non-trivial detector block before the routing block", () => {
    const source = readBrainstormerSource();
    const detectorIdx = source.indexOf("<non-trivial-detector");
    const routingIdx = source.indexOf("<routing-by-requested-output");

    expect(detectorIdx).toBeGreaterThan(-1);
    expect(routingIdx).toBeGreaterThan(-1);
    expect(detectorIdx).toBeLessThan(routingIdx);
  });

  it("non-trivial-detector marks priority as HIGHEST", () => {
    const source = readBrainstormerSource();
    const match = source.match(/<non-trivial-detector\s+priority="([^"]+)"/);

    expect(match?.[1]).toBe("HIGHEST");
  });

  it("forbids executor-direct for agent prompt and slash command surfaces", () => {
    const source = readBrainstormerSource().toLowerCase();

    // The detector or the direct-execution forbidden-for list must mention these surfaces.
    expect(source).toContain("agent");
    expect(source).toMatch(/slash[-\s]?command/);
  });

  it("forbids executor-direct for runtime, deploy, and workflow/lifecycle surfaces", () => {
    const source = readBrainstormerSource().toLowerCase();

    expect(source).toMatch(/runtime[-\s]sensitive|runtime\s+behavior|runtime\s+deploy/);
    expect(source).toMatch(/deploy/);
    expect(source).toMatch(/workflow|lifecycle/);
  });

  it("forbids executor-direct for cross-module feature work", () => {
    const source = readBrainstormerSource().toLowerCase();

    expect(source).toMatch(/cross[-\s]?module/);
  });

  it("direct-execution output-class declares a forbidden-for sub-list", () => {
    const source = readBrainstormerSource();
    const match = source.match(
      /<output-class name="direct-execution" agent="executor-direct">([\s\S]*?)<\/output-class>/,
    );

    expect(match).not.toBeNull();
    const body = match?.[1] ?? "";
    expect(body).toContain("<forbidden-for");
  });

  it("preserves quick-mode legitimacy for trivial single-file or local-op tasks", () => {
    const source = readBrainstormerSource().toLowerCase();

    // The design constraint: trivial work must still have a path through direct execution.
    // We assert the prompt still mentions trivial / single-file / local-op as legitimate inputs.
    expect(source).toMatch(/trivial|single[-\s]file|local\s+op|typo/);
  });

  it("non-trivial-detector explicitly routes forbidden cases through lifecycle plus planner plus executor", () => {
    const source = readBrainstormerSource();
    const match = source.match(/<non-trivial-detector[\s\S]*?<\/non-trivial-detector>/);

    expect(match).not.toBeNull();
    const body = (match?.[0] ?? "").toLowerCase();
    expect(body).toContain("lifecycle");
    expect(body).toContain("planner");
    expect(body).toContain("executor");
  });

  it("non-trivial-detector forbids silent downgrade to executor-direct", () => {
    const source = readBrainstormerSource();
    const match = source.match(/<non-trivial-detector[\s\S]*?<\/non-trivial-detector>/);

    expect(match).not.toBeNull();
    const body = (match?.[0] ?? "").toLowerCase();
    // Must reference executor-direct AND a denial verb (forbidden / never / must not / do not).
    expect(body).toContain("executor-direct");
    expect(body).toMatch(/forbidden|never|must not|do not|cannot/);
  });
});
```

**Implementation code (modification to `src/agents/brainstormer.ts`):**

The change has two surgical inserts. Apply them with `Edit` tool, NOT a full file rewrite, so unrelated prompt content stays untouched.

**Insert A:** Add a new top-level block immediately after the closing `</critical-rules>` tag (currently around line 96) and before `<routing-by-requested-output ...>` (currently around line 98). Insert this exact XML block:

```typescript
// Inside the brainstormerAgent.prompt template literal, between
// </critical-rules> and <routing-by-requested-output ...>, insert:

`</critical-rules>

<non-trivial-detector priority="HIGHEST">
Before any routing or effort estimation, classify the request. If the request touches ANY
of the following surfaces, it is non-trivial by default and MUST go through lifecycle plus
design plus planner plus executor. Direct execution via executor-direct is forbidden for
these surfaces, even when the change feels small.

<forbidden-surface name="agent">
Any change to files under src/agents/, including agent prompts, agent registration,
or agent tool overrides.
</forbidden-surface>

<forbidden-surface name="slash-command">
Any change that adds, removes, or modifies a slash command (registered in src/index.ts
or equivalent), or changes a command's argument contract.
</forbidden-surface>

<forbidden-surface name="runtime">
Any runtime-sensitive change: anything loaded by the live OpenCode plugin from
/root/.micode, anything that requires bun run deploy:runtime to take effect, or
anything that changes how the plugin boots or registers handlers.
</forbidden-surface>

<forbidden-surface name="deploy">
Any change to deploy scripts, deploy:runtime helpers, build configuration, or
release flow.
</forbidden-surface>

<forbidden-surface name="workflow-lifecycle">
Any change under src/lifecycle/, src/hooks/lifecycle/, or any file that participates
in lifecycle pre-flight, commit, finish, recovery, or progress logging. Includes
issue body markers, PR creation logic, and merge strategy code.
</forbidden-surface>

<forbidden-surface name="cross-module">
Any feature whose implementation spans two or more directories under src/, or whose
test surface spans two or more directories under tests/. Cross-module work always
needs a plan even if individual edits look small.
</forbidden-surface>

<rule>
If the request matches any forbidden-surface, state the classification in one sentence
("This is workflow-sensitive: routing through lifecycle + planner + executor."), then
proceed normally through the design phase. Do NOT downgrade to executor-direct.
</rule>

<rule>
Quick-mode (typo, single-line local patch, single-file local-op outside the surfaces
above) is still a legitimate path. The detector is an allow-list inverted: only
trivial work that touches none of the forbidden surfaces is eligible for
executor-direct.
</rule>

<rule>
Never silently downgrade non-trivial work into executor-direct. The detector runs
BEFORE effort estimation, so "the change is only N lines" is not a valid override.
</rule>
</non-trivial-detector>

<routing-by-requested-output priority="critical" description="During design exploration, pick the subagent by what the user wants as output, not by keywords">`
```

**Insert B:** Extend the existing `<output-class name="direct-execution" agent="executor-direct">` block (currently around lines 125-132) with a `<forbidden-for>` sub-list. Replace the existing block body with:

```typescript
// Replace the current <output-class name="direct-execution" ...>...</output-class>
// block with this expanded version:

`<output-class name="direct-execution" agent="executor-direct">
  During design exploration, if the conversation has converged on a small bounded scope
  with explicit steps and named files / hosts / verification, AND no plan file is needed
  because a single agent can finish the work in one session, route to executor-direct.
  This is the rare case where design exploration ends in a no-plan direct change rather
  than handing off to planner. executor-direct never owns lifecycle state and never
  spawns subagents.

  <forbidden-for>
  The non-trivial-detector block above lists surfaces that are NEVER eligible for
  executor-direct, regardless of how small the change feels: agent prompts, slash
  commands, runtime-sensitive code, deploy flow, workflow/lifecycle infrastructure,
  and any cross-module feature. If the request matches any of those, route through
  lifecycle + planner + executor instead.
  </forbidden-for>
</output-class>`
```

**Implementer notes:**
- Use the `Edit` tool with two separate edits: one for Insert A (matching the unique substring `</critical-rules>\n\n<routing-by-requested-output`), one for Insert B (matching the full existing direct-execution output-class block as `oldString`).
- Do not re-flow surrounding whitespace. The template literal is whitespace-significant for prompt readability.
- After both edits, run the test command below to confirm both new and old assertions pass.

**Verify:** `bun test tests/agents/brainstormer.test.ts tests/agents/executor-direct-routing.test.ts`
**Commit:** `fix(brainstormer): forbid executor-direct for agent slash-command runtime deploy lifecycle and cross-module surfaces`
