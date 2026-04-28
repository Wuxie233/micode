# Octto Multi-Session Isolation and Draft-Before-Send Implementation Plan

**Goal:** Make Octto safe for concurrent OpenCode conversations and let the user edit / re-pick answers in the browser before they are committed to the agent.

**Architecture:** Replace the per-session random-port Bun server with one process-wide shared server that exposes session-scoped routes (`/s/:id`, `/ws/:id`). Add a parent-session ownership guard to every Octto MCP tool. Change the browser bundle so `Submit` records a local draft and only the global `Send N answers` action emits the WebSocket `response` message; per-card `Edit` reverts a draft back to the input controls. Deep rollback of already-sent answers (the brainstorm/probe consumption case) is intentionally Phase 2 and NOT in this plan.

**Design:** No formal design doc exists for this work; the user-supplied recovery brief in the kickoff message is the spec, and `thoughts/shared/plans/2026-04-26-octto-multisession-and-rollback-contract.md` is its frozen interface.

**Contract:** `thoughts/shared/plans/2026-04-26-octto-multisession-and-rollback-contract.md`

---

## Operator Notes for the Executor

Read these BEFORE dispatching the first task.

1. **Do NOT restart any OpenCode service or process** (no `systemctl restart opencode-web.service`, no `restart-opencode-detached`, no manual `opencode web` / `opencode serve` restart) at any point in this plan. All verification is via `bun test` only. If a task seems to require a live restart, escalate instead.
2. **Working tree triage before Batch 1.** The working tree currently has these unrelated residuals; preserve them and DO NOT revert:
   - Modified: `.gitignore`, `src/utils/config.ts`, `tests/tools/octto/config.test.ts` (the env-var test already passes against the current `config.ts` and is the basis for Batch 1's config task; treat it as the de facto failing-then-passing pair).
   - Untracked: `.playwright-mcp/`, `ARCHITECTURE.md`, `CODE_STYLE.md` — leave them alone, they are not in scope.
3. **The stash `stash@{0} octto-direct-edits-pre-plan` is REFERENCE ONLY.** Do NOT `git stash apply`. Implementers may `git stash show -p stash@{0} -- <path>` to peek at how the user previously sketched a change, but every code change in this plan is to be made fresh against the current working tree using the snippets in this plan and the contract.
4. **Domain dispatch.** This plan crosses both `backend` and `frontend`, so the contract above is frozen and implementers MUST conform. Any cross-domain mismatch is escalated, not patched locally.
5. **TDD.** Every backend task has a test file that must fail first, then pass after the implementation. The frontend bundle is a single template literal; its task uses a JSDOM-driven test as the failing-first pair.
6. **Phase 2 is out of scope.** If a task feels like it needs to "unsend" an already-committed answer, stop and escalate — that work is reserved for a future plan.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4 [foundation - no code-deps on each other]
Batch 2 (parallel): 2.1, 2.2 [shared server + session-store refactor; depend on 1.1, 1.2, 1.3]
Batch 3 (parallel): 3.1, 3.2, 3.3 [tool-layer ownership wiring; depend on 1.4 + 2.2]
Batch 4 (parallel): 4.1 [browser bundle; depends on 2.1 (URL shape) + 2.2 (ownerSessionID semantics) only via the contract]
Batch 5 (parallel): 5.1 [end-to-end test of the shared-server + ownership stack; depends on 2.1, 2.2, 3.1, 3.2, 3.3]
Batch 6 (parallel): 6.1 [README/CHANGELOG note; depends on everything]
```

Batch 4 only depends on the contract being frozen, not on backend code being merged, because the bundle is a static template; its test mounts the bundle in JSDOM with a fake WebSocket. The integration test in Batch 5 is what proves the wire contract end-to-end.

---

## Batch 1: Foundation (parallel)

All four tasks are independent and can run simultaneously.

### Task 1.1: Add `OcttoForbiddenError` and ownership types

**File:** `src/octto/session/errors.ts`
**Test:** `tests/octto/session/errors.test.ts`
**Depends:** none
**Domain:** backend

Reasoning: The contract requires a tagged error class that the tool layer can catch and convert to the standard `## Forbidden` Markdown response. Putting it in its own file keeps `sessions.ts` focused on the store. Project rules forbid classes for business logic, but tagged errors are a documented exception (errors-as-values pattern); we use a `class extends Error` with a discriminant `name`.

```typescript
// tests/octto/session/errors.test.ts
import { describe, expect, it } from "bun:test";

import { isOcttoForbiddenError, OcttoForbiddenError } from "@/octto/session/errors";

describe("OcttoForbiddenError", () => {
  it("carries the offending octto session id and the actual owner", () => {
    const err = new OcttoForbiddenError("octto-abc", "owner-xyz", "caller-qrs");
    expect(err.octtoSessionId).toBe("octto-abc");
    expect(err.ownerSessionID).toBe("owner-xyz");
    expect(err.callerSessionID).toBe("caller-qrs");
    expect(err.name).toBe("OcttoForbiddenError");
    expect(err instanceof Error).toBe(true);
  });

  it("isOcttoForbiddenError narrows correctly", () => {
    const err: unknown = new OcttoForbiddenError("a", "b", "c");
    expect(isOcttoForbiddenError(err)).toBe(true);
    expect(isOcttoForbiddenError(new Error("nope"))).toBe(false);
    expect(isOcttoForbiddenError("string")).toBe(false);
  });
});
```

```typescript
// src/octto/session/errors.ts
export class OcttoForbiddenError extends Error {
  readonly name = "OcttoForbiddenError" as const;
  constructor(
    readonly octtoSessionId: string,
    readonly ownerSessionID: string,
    readonly callerSessionID: string,
  ) {
    super(
      `Octto session ${octtoSessionId} is owned by ${ownerSessionID}, refusing access from ${callerSessionID}`,
    );
  }
}

export function isOcttoForbiddenError(value: unknown): value is OcttoForbiddenError {
  return value instanceof OcttoForbiddenError;
}
```

**Verify:** `bun test tests/octto/session/errors.test.ts`
**Commit:** `feat(octto): add OcttoForbiddenError tagged error for ownership guard`

---

### Task 1.2: Add `formatForbidden` helper for tool responses

**File:** `src/tools/octto/forbidden.ts`
**Test:** `tests/tools/octto/forbidden.test.ts`
**Depends:** none
**Domain:** backend

Reasoning: The contract pins the exact Markdown shape returned to the agent on ownership failure. Centralizing it in one helper keeps the wording identical across every tool (`start_session`, `end_session`, `push_question`, `get_answer`, etc.) and satisfies the project's no-duplicate-string-literals rule.

```typescript
// tests/tools/octto/forbidden.test.ts
import { describe, expect, it } from "bun:test";

import { formatForbidden } from "@/tools/octto/forbidden";

describe("formatForbidden", () => {
  it("returns the canonical Markdown error including the offending session id", () => {
    const out = formatForbidden("octto-abc");
    expect(out).toContain("## Forbidden");
    expect(out).toContain("Session octto-abc");
    expect(out).toContain("different OpenCode conversation");
    expect(out).toContain("call start_session in this conversation");
  });
});
```

```typescript
// src/tools/octto/forbidden.ts
const HEADER = "## Forbidden";
const HINT = "Hint: call start_session in this conversation to get a session_id you own.";

export function formatForbidden(octtoSessionId: string): string {
  return `${HEADER}

Session ${octtoSessionId} belongs to a different OpenCode conversation. Each OpenCode conversation owns its own Octto sessions.

${HINT}`;
}
```

**Verify:** `bun test tests/tools/octto/forbidden.test.ts`
**Commit:** `feat(octto): add formatForbidden helper for ownership errors`

---

### Task 1.3: Re-export errors and types from the session barrel

**File:** `src/octto/session/index.ts`
**Test:** none (barrel-only re-exports)
**Depends:** none
**Domain:** backend

Reasoning: Tools and tests import from `@/octto/session`. We need `OcttoForbiddenError` and `isOcttoForbiddenError` reachable through the barrel so callers do not reach into `@/octto/session/errors` directly. Implementer should ADD the two named re-exports to whatever existing re-export list lives in this file. Do not remove existing re-exports.

Action: open `src/octto/session/index.ts`, locate the existing block of `export ... from "./..."` lines, and append:

```typescript
export { isOcttoForbiddenError, OcttoForbiddenError } from "./errors";
```

If `src/octto/session/index.ts` already has a `from "./errors"` re-export (it should not), merge into that line instead of duplicating.

**Verify:** `bun run typecheck`
**Commit:** `chore(octto): re-export OcttoForbiddenError from session barrel`

---

### Task 1.4: Add ownership-related fields to types

**File:** `src/octto/session/types.ts`
**Test:** none (type-level change only; covered indirectly by 2.2 + 5.1)
**Depends:** none
**Domain:** backend

Reasoning: The contract adds `ownerSessionID` to `Session` and `StartSessionInput`, and removes the per-session `port` / `server` fields because the server is now process-wide. Type changes are isolated here so Batch 2 can refactor consumers in parallel.

Action:

1. In the existing `Session` interface, REMOVE the `port: number` field, REMOVE the `server?: ReturnType<typeof Bun.serve>` field, and ADD `readonly ownerSessionID: string;` immediately above `wsConnected`.
2. In the existing `StartSessionInput` interface, ADD `readonly ownerSessionID: string;` after `questions`.
3. Remove the now-unused `import type` of `ServerWebSocket` ONLY IF it is still imported solely for the deleted `server` field; if `wsClient?: ServerWebSocket<unknown>` still needs it, keep it.

The full updated interfaces should look like:

```typescript
export interface Session {
  readonly id: string;
  readonly title?: string;
  readonly url: string;
  readonly createdAt: Date;
  readonly questions: Map<string, Question>;
  readonly ownerSessionID: string;
  wsConnected: boolean;
  wsClient?: ServerWebSocket<unknown>;
}

export interface StartSessionInput {
  readonly title?: string;
  readonly questions?: InitialQuestion[];
  readonly ownerSessionID: string;
}
```

**Verify:** `bun run typecheck` (will surface the consumers Batch 2 must fix)
**Commit:** `refactor(octto): replace per-session port/server with ownerSessionID`

---

## Batch 2: Shared server + ownership-aware session store (parallel)

These two tasks split the engine work along the file boundary. They both depend on Batch 1 being merged because they consume the new types and `OcttoForbiddenError`.

### Task 2.1: Refactor `createServer` into a process-wide shared server

**File:** `src/octto/session/server.ts`
**Test:** `tests/octto/session/server.test.ts`
**Depends:** 1.4
**Domain:** backend

Reasoning: The contract requires one server per process, with `/s/:sessionId`, `/ws/:sessionId`, and `/healthz`. The bundle is rewritten on every fetch to inject the sessionId via the `__OCTTO_SESSION_ID_PLACEHOLDER__` literal. Unknown sessionIds get `404` for both HTML and WS upgrade. We expose a `getSharedServer(store, options)` factory that lazily starts on first call and idempotently returns the same handle.

The store passed in must implement two new read methods used by the server:

- `hasSession(id: string): boolean`
- `handleWsConnect`, `handleWsDisconnect`, `handleWsMessage` (existing).

This task does NOT change the store; it changes the server interface and `Session` consumers. Where the existing code reads `session.server` to call `server.stop()` during teardown, that call moves out of `endSession` because the server is now shared. The shared server only stops when the entire process exits; for now we expose `stopSharedServer()` for tests and process shutdown only.

```typescript
// tests/octto/session/server.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { getSharedServer, stopSharedServer } from "@/octto/session/server";
import type { SessionStore } from "@/octto/session/sessions";

const SESSION_ID = "octto-session-1";

function fakeStore(known: Set<string>): SessionStore {
  return {
    startSession: async () => ({ session_id: "x", url: "x" }),
    endSession: async () => ({ ok: true }),
    pushQuestion: () => ({ question_id: "q" }),
    getAnswer: async () => ({ completed: false, status: "pending" }),
    getNextAnswer: async () => ({ completed: false, status: "none_pending" }),
    cancelQuestion: () => ({ ok: false }),
    listQuestions: () => ({ questions: [] }),
    handleWsConnect: () => {},
    handleWsDisconnect: () => {},
    handleWsMessage: () => {},
    getSession: (id) => (known.has(id) ? ({ id } as never) : undefined),
    cleanup: async () => {},
    hasSession: (id: string) => known.has(id),
    assertOwner: () => {},
    isOwner: () => true,
    listOwnedSessions: () => [],
  } as unknown as SessionStore;
}

describe("shared octto server", () => {
  let known: Set<string>;
  let port: number;

  beforeEach(async () => {
    known = new Set([SESSION_ID]);
    const server = await getSharedServer(fakeStore(known), { port: 0 });
    port = server.port;
  });

  afterEach(async () => {
    await stopSharedServer();
  });

  it("returns 404 on root path", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("session-scoped URL");
  });

  it("serves the bundle with the sessionId injected for known sessions", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/s/${SESSION_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const body = await res.text();
    expect(body).toContain(`"${SESSION_ID}"`);
    expect(body).not.toContain("__OCTTO_SESSION_ID_PLACEHOLDER__");
  });

  it("returns 404 for unknown sessionId", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/s/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("returns 200 ok on /healthz", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("rejects ws upgrade for unknown sessionId with 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/ws/unknown`, {
      headers: { upgrade: "websocket", connection: "upgrade" },
    });
    expect(res.status).toBe(404);
  });

  it("returns the same server handle on second getSharedServer call", async () => {
    const a = await getSharedServer(fakeStore(known), { port: 0 });
    const b = await getSharedServer(fakeStore(known), { port: 0 });
    expect(a.port).toBe(b.port);
  });
});
```

```typescript
// src/octto/session/server.ts
import type { Server, ServerWebSocket } from "bun";
import * as v from "valibot";

import { getHtmlBundle } from "@/octto/ui";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import { WsClientMessageSchema } from "./schemas";
import type { SessionStore } from "./sessions";
import type { WsClientMessage } from "./types";

interface WsData {
  sessionId: string;
}

interface SharedServerOptions {
  /** Override the configured port; primarily for tests. */
  port?: number;
}

const SESSION_PATH_RE = /^\/s\/([^/]+)\/?$/;
const WS_PATH_RE = /^\/ws\/([^/]+)\/?$/;
const PLACEHOLDER = "__OCTTO_SESSION_ID_PLACEHOLDER__";
const ROOT_NOT_FOUND_BODY = "Octto requires a session-scoped URL: /s/:sessionId";

let sharedServer: Server<WsData> | undefined;
let sharedStore: SessionStore | undefined;

export interface SharedServerHandle {
  readonly server: Server<WsData>;
  readonly port: number;
}

export async function getSharedServer(
  store: SessionStore,
  options: SharedServerOptions = {},
): Promise<SharedServerHandle> {
  if (sharedServer) {
    sharedStore = store;
    return { server: sharedServer, port: sharedServer.port ?? 0 };
  }

  const port = options.port ?? config.octto.port;
  sharedStore = store;
  sharedServer = Bun.serve<WsData>({
    port,
    hostname: config.octto.allowRemoteBind ? config.octto.bindAddress : "127.0.0.1",
    fetch: handleFetch,
    websocket: {
      open(ws) {
        sharedStore?.handleWsConnect(ws.data.sessionId, ws);
      },
      close(ws) {
        sharedStore?.handleWsDisconnect(ws.data.sessionId);
      },
      message(ws, message) {
        handleWsMessage(ws, message);
      },
    },
  });

  return { server: sharedServer, port: sharedServer.port ?? 0 };
}

export async function stopSharedServer(): Promise<void> {
  if (!sharedServer) return;
  await sharedServer.stop();
  sharedServer = undefined;
  sharedStore = undefined;
}

function handleFetch(req: Request, server: Server<WsData>): Response | undefined {
  const url = new URL(req.url);

  if (url.pathname === "/healthz") {
    return new Response("ok", { status: 200 });
  }

  const wsMatch = WS_PATH_RE.exec(url.pathname);
  if (wsMatch) return tryUpgrade(req, server, wsMatch[1] ?? "");

  const sessionMatch = SESSION_PATH_RE.exec(url.pathname);
  if (sessionMatch) return serveBundle(sessionMatch[1] ?? "");

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return new Response(ROOT_NOT_FOUND_BODY, { status: 404 });
  }

  return new Response("Not Found", { status: 404 });
}

function tryUpgrade(req: Request, server: Server<WsData>, sessionId: string): Response | undefined {
  if (!sharedStore?.hasSession(sessionId)) {
    return new Response(`Unknown Octto session: ${sessionId}`, { status: 404 });
  }
  const ok = server.upgrade(req, { data: { sessionId } });
  if (ok) return undefined;
  return new Response("WebSocket upgrade failed", { status: 400 });
}

function serveBundle(sessionId: string): Response {
  if (!sharedStore?.hasSession(sessionId)) {
    return new Response(`Unknown Octto session: ${sessionId}`, { status: 404 });
  }
  const injected = getHtmlBundle().replace(PLACEHOLDER, JSON.stringify(sessionId));
  return new Response(injected, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function handleWsMessage(ws: ServerWebSocket<WsData>, message: string | Buffer): void {
  if (!sharedStore) return;
  let raw: unknown;
  try {
    raw = JSON.parse(message.toString());
  } catch (error) {
    log.error("octto", "Failed to parse WebSocket message", error);
    ws.send(JSON.stringify({ type: "error", error: "Invalid message format", details: extractErrorMessage(error) }));
    return;
  }

  const result = v.safeParse(WsClientMessageSchema, raw);
  if (!result.success) {
    log.error("octto", "Invalid WebSocket message schema", result.issues);
    ws.send(
      JSON.stringify({
        type: "error",
        error: "Invalid message schema",
        details: result.issues.map((i) => i.message).join("; "),
      }),
    );
    return;
  }

  sharedStore.handleWsMessage(ws.data.sessionId, result.output as WsClientMessage);
}
```

**Verify:** `bun test tests/octto/session/server.test.ts`
**Commit:** `feat(octto): replace per-session server with shared session-scoped server`

---

### Task 2.2: Wire ownership and shared server into the session store

**File:** `src/octto/session/sessions.ts`
**Test:** `tests/octto/session/sessions-ownership.test.ts`
**Depends:** 1.1, 1.2, 1.3, 1.4 (uses new types and error)
**Domain:** backend

Reasoning: The store now records `ownerSessionID` per Octto session, exposes `assertOwner` / `isOwner` / `listOwnedSessions` / `hasSession`, no longer creates its own server, and computes `session.url` from `config.octto.publicBaseUrl` if set, falling back to the loopback URL with the shared server's port. `endSession` no longer stops a server (because there is no per-session server); it only ends the session and cleans waiters.

The implementation reuses all existing pure helpers (`registerInitialQuestions`, `cancelPendingQuestion`, etc.) and only changes `initSession`, `teardownSession`, `cleanup`, and adds the new ownership helpers.

```typescript
// tests/octto/session/sessions-ownership.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { OcttoForbiddenError } from "@/octto/session/errors";
import { stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";

const QUESTIONS = [
  { type: "ask_text" as const, config: { question: "hi" } },
];

describe("session store ownership and shared server", () => {
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    store = createSessionStore({ skipBrowser: true });
  });

  afterEach(async () => {
    await store.cleanup();
    await stopSharedServer();
  });

  it("records ownerSessionID at startSession and exposes it via getSession", async () => {
    const out = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    const sess = store.getSession(out.session_id);
    expect(sess?.ownerSessionID).toBe("owner-A");
  });

  it("assertOwner throws OcttoForbiddenError when the caller does not match", async () => {
    const out = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    expect(() => store.assertOwner(out.session_id, "owner-B")).toThrow(OcttoForbiddenError);
    expect(store.assertOwner(out.session_id, "owner-A")).toBeUndefined();
  });

  it("isOwner returns true only for the exact owner", async () => {
    const out = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    expect(store.isOwner(out.session_id, "owner-A")).toBe(true);
    expect(store.isOwner(out.session_id, "owner-B")).toBe(false);
    expect(store.isOwner("nonexistent", "owner-A")).toBe(false);
  });

  it("listOwnedSessions filters by owner", async () => {
    const a1 = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    const a2 = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    const b1 = await store.startSession({ ownerSessionID: "owner-B", questions: QUESTIONS });
    const ownedByA = store.listOwnedSessions("owner-A").sort();
    expect(ownedByA).toEqual([a1.session_id, a2.session_id].sort());
    expect(store.listOwnedSessions("owner-B")).toEqual([b1.session_id]);
  });

  it("returns a session url derived from publicBaseUrl when configured", async () => {
    const original = process.env["OCTTO_PUBLIC_BASE_URL"];
    process.env["OCTTO_PUBLIC_BASE_URL"] = "https://octto.wuxie233.com";
    try {
      // re-import config + sessions with the new env var
      const mod = await import("@/octto/session/sessions?cache=public");
      const localStore = mod.createSessionStore({ skipBrowser: true });
      const out = await localStore.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
      expect(out.url).toBe(`https://octto.wuxie233.com/s/${out.session_id}`);
      await localStore.cleanup();
    } finally {
      if (original === undefined) delete process.env["OCTTO_PUBLIC_BASE_URL"];
      else process.env["OCTTO_PUBLIC_BASE_URL"] = original;
      await stopSharedServer();
    }
  });

  it("hasSession reflects current sessions", async () => {
    const out = await store.startSession({ ownerSessionID: "owner-A", questions: QUESTIONS });
    expect(store.hasSession(out.session_id)).toBe(true);
    expect(store.hasSession("missing")).toBe(false);
    await store.endSession(out.session_id);
    expect(store.hasSession(out.session_id)).toBe(false);
  });
});
```

**Implementation guidance** (do not blindly copy; merge into the existing file):

1. Add at the top of `sessions.ts`:
   ```typescript
   import { config } from "@/utils/config";
   import { OcttoForbiddenError } from "./errors";
   import { getSharedServer } from "./server";
   ```
2. Extend the `SessionStore` interface with:
   ```typescript
   hasSession: (id: string) => boolean;
   assertOwner: (sessionId: string, ownerSessionID: string) => void;
   isOwner: (sessionId: string, ownerSessionID: string) => boolean;
   listOwnedSessions: (ownerSessionID: string) => string[];
   ```
3. In `initSession`:
   - Replace `const { server, port } = await createServer(sessionId, store);` with `const { port } = await getSharedServer(store);`.
   - Build `url` as: `const url = config.octto.publicBaseUrl ? `${config.octto.publicBaseUrl}/s/${sessionId}` : `http://127.0.0.1:${port}/s/${sessionId}`;`.
   - When constructing the `Session` object, drop `port` and `server`, add `ownerSessionID: input.ownerSessionID`.
   - On browser-open failure, do NOT call `server.stop()`. Just delete the session and questions. The shared server stays up.
   - Open the browser at the new `url` (already correct).
4. In `teardownSession`: remove the `await session.server.stop()` call entirely. Keep the rest (END message, waiter cleanup, deletes).
5. Implement the four new methods. `assertOwner` throws `OcttoForbiddenError` only when the session exists and the owner does not match; if the session does not exist, throw a plain `Error("Session not found: ...")` so the tool layer can map that to its existing not-found message.
6. `cleanup()` keeps its current behavior (end every session) and additionally must NOT stop the shared server, because other test suites or other Octto sessions in the same process may still need it. Test teardown calls `stopSharedServer()` explicitly.

Note on legacy `createServer`: that named export is removed. Any caller outside the octto module that imported it must be updated; do NOT add a shim.

**Verify:** `bun test tests/octto/session/sessions-ownership.test.ts`
**Commit:** `feat(octto): record ownerSessionID and route through shared server`

---

## Batch 3: Tool-layer ownership wiring (parallel)

All three tasks consume the new types and store from Batch 1 + 2. They edit different files, so they run in parallel.

### Task 3.1: Wire ownership into `start_session` and `end_session`

**File:** `src/tools/octto/session.ts`
**Test:** `tests/tools/octto/session-ownership.test.ts`
**Depends:** 1.2, 2.2
**Domain:** backend

Reasoning: `start_session` is the moment ownership is recorded; we add `ownerSessionID: context.sessionID` to the store call. `end_session` MUST refuse to end someone else's session and return the canonical forbidden message.

```typescript
// tests/tools/octto/session-ownership.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";
import { createSessionTools } from "@/tools/octto/session";

const fakeContext = (sessionID: string) => ({ sessionID } as never);
const askText = [{ type: "ask_text" as const, config: { question: "hi" } }];

describe("session tools ownership", () => {
  let store: ReturnType<typeof createSessionStore>;
  let tools: ReturnType<typeof createSessionTools>;

  beforeEach(() => {
    store = createSessionStore({ skipBrowser: true });
    tools = createSessionTools(store);
  });

  afterEach(async () => {
    await store.cleanup();
    await stopSharedServer();
  });

  it("end_session refuses for a non-owning caller and returns the forbidden Markdown", async () => {
    const startOut = (await tools.start_session.execute(
      { questions: askText } as never,
      fakeContext("owner-A"),
    )) as string;
    const idMatch = /Session ID \| (\S+)/.exec(startOut);
    const id = idMatch?.[1] ?? "";
    expect(id).not.toBe("");

    const endOut = (await tools.end_session.execute({ session_id: id } as never, fakeContext("owner-B"))) as string;
    expect(endOut).toContain("## Forbidden");
    expect(endOut).toContain(`Session ${id}`);

    // session is still alive for the real owner
    expect(store.hasSession(id)).toBe(true);
  });

  it("end_session works for the owning caller", async () => {
    const startOut = (await tools.start_session.execute(
      { questions: askText } as never,
      fakeContext("owner-A"),
    )) as string;
    const id = (/Session ID \| (\S+)/.exec(startOut) ?? [])[1] ?? "";
    const endOut = (await tools.end_session.execute({ session_id: id } as never, fakeContext("owner-A"))) as string;
    expect(endOut).toContain("ended successfully");
    expect(store.hasSession(id)).toBe(false);
  });
});
```

**Implementation guidance:**

1. In `buildStartSessionTool`, change the `sessions.startSession` call to include `ownerSessionID: context.sessionID`:
   ```typescript
   const session = await sessions.startSession({
     title: args.title,
     questions,
     ownerSessionID: context.sessionID,
   });
   ```
2. In `buildEndSessionTool`, BEFORE calling `sessions.endSession`, run the ownership guard:
   ```typescript
   if (!sessions.hasSession(args.session_id)) {
     return `Failed to end session ${args.session_id}. It may not exist.`;
   }
   if (!sessions.isOwner(args.session_id, context.sessionID)) {
     return formatForbidden(args.session_id);
   }
   ```
   Then keep the existing `endSession` + `tracker?.onEnded` logic.
3. Add `import { formatForbidden } from "./forbidden";`.

**Verify:** `bun test tests/tools/octto/session-ownership.test.ts`
**Commit:** `feat(octto): record owner on start_session, guard end_session by owner`

---

### Task 3.2: Wire ownership into `push_question` and the typed question factory

**File:** `src/tools/octto/factory.ts`
**Test:** `tests/tools/octto/factory-ownership.test.ts`
**Depends:** 1.2, 2.2
**Domain:** backend

Reasoning: Both the generic `push_question` and every typed `createQuestionTool`-built tool take a `session_id`. They MUST refuse if the caller is not the owner, before mutating any session state. Not-found wins over forbidden.

```typescript
// tests/tools/octto/factory-ownership.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";
import { createPushQuestionTool, createQuestionToolFactory } from "@/tools/octto/factory";

const fakeContext = (sessionID: string) => ({ sessionID } as never);
const askText = [{ type: "ask_text" as const, config: { question: "hi" } }];

describe("question tool factory ownership", () => {
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    store = createSessionStore({ skipBrowser: true });
  });

  afterEach(async () => {
    await store.cleanup();
    await stopSharedServer();
  });

  it("push_question refuses for non-owner and does not push", async () => {
    const start = await store.startSession({ ownerSessionID: "owner-A", questions: askText });
    const { push_question } = createPushQuestionTool(store);

    const out = (await push_question.execute(
      { session_id: start.session_id, type: "ask_text", config: { question: "hijack?" } } as never,
      fakeContext("owner-B"),
    )) as string;

    expect(out).toContain("## Forbidden");
    const session = store.getSession(start.session_id);
    expect(session?.questions.size).toBe(1); // only the initial question
  });

  it("push_question returns existing not-found error for unknown session", async () => {
    const { push_question } = createPushQuestionTool(store);
    const out = (await push_question.execute(
      { session_id: "missing", type: "ask_text", config: { question: "x" } } as never,
      fakeContext("owner-A"),
    )) as string;
    expect(out).toContain("Failed");
    expect(out).not.toContain("## Forbidden");
  });

  it("typed factory tool refuses for non-owner", async () => {
    const start = await store.startSession({ ownerSessionID: "owner-A", questions: askText });
    const factory = createQuestionToolFactory(store);
    const askTextTool = factory<{ session_id: string; question: string }>({
      type: "ask_text",
      description: "ask text",
      args: {},
      toConfig: (a) => ({ question: a.question }),
    });
    const out = (await askTextTool.execute(
      { session_id: start.session_id, question: "from B" } as never,
      fakeContext("owner-B"),
    )) as string;
    expect(out).toContain("## Forbidden");
  });
});
```

**Implementation guidance:**

1. Both `createQuestionToolFactory(...)` and `createPushQuestionTool(...)` receive `sessions: SessionStore`. Inside their `execute` callbacks, add the guard at the top, BEFORE validation or push:
   ```typescript
   if (!sessions.hasSession(args.session_id)) {
     return `Failed: session ${args.session_id} not found`;
   }
   if (!sessions.isOwner(args.session_id, context.sessionID)) {
     return formatForbidden(args.session_id);
   }
   ```
   Note: the existing not-found path was implicit (the store threw `Session not found`); we now make it explicit so the not-found-wins-over-forbidden ordering is unambiguous.
2. Update both `execute` signatures to accept `(args, context)` instead of `(args)`. The plugin SDK passes both; the existing `start_session` already uses it.
3. Add `import { formatForbidden } from "./forbidden";` to the file.

**Verify:** `bun test tests/tools/octto/factory-ownership.test.ts`
**Commit:** `feat(octto): guard push_question and typed question tools by owner`

---

### Task 3.3: Wire ownership into the response and listing tools

**File:** `src/tools/octto/responses.ts`
**Test:** `tests/tools/octto/responses-ownership.test.ts`
**Depends:** 1.2, 2.2
**Domain:** backend

Reasoning: `get_answer`, `get_next_answer`, `cancel_question`, and `list_questions` are how an agent in conversation B could observe or mutate conversation A's session if ownership were not enforced. We map question_id -> sessionId via `getSession` (the store already maintains a `questionToSession` map; we expose a small read helper or look up via existing `getSession` iteration). For simplicity and to avoid a new public API surface, this task adds one tiny helper `findSessionIdByQuestion` to the store interface.

```typescript
// tests/tools/octto/responses-ownership.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";
import { createResponseTools } from "@/tools/octto/responses";

const fakeContext = (sessionID: string) => ({ sessionID } as never);
const askText = [{ type: "ask_text" as const, config: { question: "hi" } }];

describe("response tools ownership", () => {
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    store = createSessionStore({ skipBrowser: true });
  });

  afterEach(async () => {
    await store.cleanup();
    await stopSharedServer();
  });

  it("get_next_answer refuses for non-owner of the session", async () => {
    const start = await store.startSession({ ownerSessionID: "owner-A", questions: askText });
    const { get_next_answer } = createResponseTools(store);
    const out = (await get_next_answer.execute(
      { session_id: start.session_id, block: false } as never,
      fakeContext("owner-B"),
    )) as string;
    expect(out).toContain("## Forbidden");
  });

  it("get_answer refuses for non-owner of the session that owns the question", async () => {
    const start = await store.startSession({ ownerSessionID: "owner-A", questions: askText });
    const session = store.getSession(start.session_id);
    const questionId = [...(session?.questions.keys() ?? [])][0] ?? "";
    const { get_answer } = createResponseTools(store);
    const out = (await get_answer.execute(
      { question_id: questionId, block: false } as never,
      fakeContext("owner-B"),
    )) as string;
    expect(out).toContain("## Forbidden");
  });

  it("cancel_question refuses for non-owner", async () => {
    const start = await store.startSession({ ownerSessionID: "owner-A", questions: askText });
    const session = store.getSession(start.session_id);
    const questionId = [...(session?.questions.keys() ?? [])][0] ?? "";
    const { cancel_question } = createResponseTools(store);
    const out = (await cancel_question.execute({ question_id: questionId } as never, fakeContext("owner-B"))) as string;
    expect(out).toContain("## Forbidden");
  });

  it("list_questions without session_id only lists sessions owned by the caller", async () => {
    const a = await store.startSession({ ownerSessionID: "owner-A", questions: askText });
    const b = await store.startSession({ ownerSessionID: "owner-B", questions: askText });
    const { list_questions } = createResponseTools(store);
    const out = (await list_questions.execute({} as never, fakeContext("owner-A"))) as string;
    // owner-A's session has 1 question; owner-B's session is excluded
    const lines = out.split("\n").filter((l) => l.startsWith("|") && !l.includes("ID"));
    expect(lines.length).toBe(1);
    void a;
    void b;
  });
});
```

**Implementation guidance:**

1. Add a method to the store interface (in `sessions.ts`) and implement it:
   ```typescript
   findSessionIdByQuestion: (questionId: string) => string | undefined;
   ```
   It looks up the existing internal `questionToSession` map.
2. In `responses.ts`, before each tool action, run:
   - For `get_answer` / `cancel_question`: derive sessionId via `findSessionIdByQuestion(args.question_id)`. If undefined, fall through to the existing not-found-style error path. If present and not owned by `context.sessionID`, return `formatForbidden(sessionId)`.
   - For `get_next_answer`: if `!sessions.hasSession(args.session_id)` use existing not-found path; else if `!isOwner` return forbidden.
   - For `list_questions` with `session_id` provided: same pattern. With `session_id` omitted: change the inner loop to iterate `sessions.listOwnedSessions(context.sessionID)` instead of all sessions.
3. Update each `execute` signature to `(args, context)`.
4. Add `import { formatForbidden } from "./forbidden";`.

**Verify:** `bun test tests/tools/octto/responses-ownership.test.ts`
**Commit:** `feat(octto): guard answer/cancel/list tools by owner`

---

## Batch 4: Browser bundle (parallel; only depends on the contract)

### Task 4.1: Replace per-question auto-send with draft + global Send

**File:** `src/octto/ui/bundle.ts`
**Test:** `tests/octto/ui/bundle-draft.test.ts`
**Depends:** none (only the frozen contract)
**Domain:** frontend

Reasoning: The bundle currently calls `submitAnswer` and immediately `ws.send`s. The contract requires per-question Submit to record a local draft, with a global `Send N answer(s)` action that flushes drafts. The implementer is free to choose how to wire this inside the existing `render()` loop: the recommended approach is to add three globals — `drafts: Map<string, { status: "draft" | "sent"; answer: any }>`, a `setDraft(qid, answer)` helper, and a `flushDrafts()` helper that iterates drafts in insertion order and `ws.send`s each. Replace every call site that currently does `ws.send(JSON.stringify({ type: 'response', id, answer }))` with `setDraft(id, answer)`. Add an `Edit` button on draft cards that calls `clearDraft(id)` and re-renders the input controls. The injected sessionId is read via the new placeholder.

The frontend MUST also switch from `ws://window.location.host/ws` to the contract-defined URL:

```js
const sessionId = JSON.parse("__OCTTO_SESSION_ID_PLACEHOLDER__"); // server replaces with a JSON-encoded id
const wsScheme = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = wsScheme + "//" + window.location.host + "/ws/" + sessionId;
```

Existing 16 question-type renderers stay; the only change is what their Submit handlers do.

```typescript
// tests/octto/ui/bundle-draft.test.ts
/**
 * Smoke test: the bundle as a string contains the contract-required tokens
 * and does NOT contain the legacy auto-send pattern.
 *
 * We do not boot a real browser. The presence of the placeholder + scoped WS
 * URL + draft helpers is enough to catch regressions where someone re-introduces
 * unscoped /ws or per-Submit ws.send for response messages.
 */
import { describe, expect, it } from "bun:test";

import { getHtmlBundle } from "@/octto/ui";

describe("octto bundle (draft + scoped ws)", () => {
  const html = getHtmlBundle();

  it("contains the session-id placeholder", () => {
    expect(html).toContain("__OCTTO_SESSION_ID_PLACEHOLDER__");
  });

  it("constructs a session-scoped WS URL", () => {
    expect(html).toContain("/ws/");
    expect(html).not.toMatch(/['"]ws:\/\/['"]\s*\+\s*window\.location\.host\s*\+\s*['"]\/ws['"]/);
  });

  it("supports https by selecting wss when location.protocol === https:", () => {
    expect(html).toContain("location.protocol === 'https:'");
    expect(html).toContain("wss:");
  });

  it("exposes draft helpers", () => {
    expect(html).toContain("setDraft");
    expect(html).toContain("clearDraft");
    expect(html).toContain("flushDrafts");
  });

  it("renders a global Send button label that includes the draft count", () => {
    // Either 'Send ' + count + ' answer' or 'Send ${count} answer'; we accept either form.
    expect(/Send\s*['"]\s*\+\s*[A-Za-z_$.]+\s*\+\s*['"]\s*answer/.test(html) || /Send \$\{[^}]+\} answer/.test(html))
      .toBe(true);
  });

  it("does not auto-send a response message at per-question Submit time", () => {
    // No `type: 'response'` literal sent inside any per-question Submit handler.
    // We grep for the legacy pattern: ws.send(JSON.stringify({ type: 'response'
    expect(html).not.toMatch(/ws\.send\(\s*JSON\.stringify\(\s*\{\s*type:\s*['"]response['"]/);
  });
});
```

**Implementation guidance:**

1. Add at the top of the inline `<script>` block:
   ```js
   const sessionId = JSON.parse("__OCTTO_SESSION_ID_PLACEHOLDER__");
   const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
   const wsUrl = wsScheme + '//' + window.location.host + '/ws/' + sessionId;
   const drafts = new Map(); // qid -> { status, answer }
   function setDraft(qid, answer) { drafts.set(qid, { status: 'draft', answer }); render(); }
   function clearDraft(qid) { drafts.delete(qid); render(); }
   function flushDrafts() {
     for (const [qid, entry] of drafts) {
       if (entry.status !== 'draft') continue;
       ws.send(JSON.stringify({ type: 'response', id: qid, answer: entry.answer }));
       entry.status = 'sent';
     }
     render();
   }
   ```
2. Replace EVERY existing Submit handler that did `ws.send(JSON.stringify({ type: 'response', id, answer }))` with `setDraft(id, answer)`. The handlers to update: `submitPickOne`, `submitPickMany`, `submitText`, `submitSlider`, `submitReview`, `submitShowOptions`, `submitDiff`, `submitRank`, `submitRate`, `submitCode`, `submitImage`, `submitFile`, `submitEmoji`, plus the inline confirm/thumbs `submitAnswer(qid, payload)` — change `submitAnswer` itself to call `setDraft(qid, payload)`.
3. In `render()`, when iterating questions:
   - A question whose questionId is in `drafts` with `status === 'draft'` renders a compact "draft" card showing the chosen answer (re-use the `readonly-answer` block style) and an `Edit` button that calls `clearDraft(qid)`.
   - A question with `status === 'sent'` is treated like the existing `q.answered` collapsed card; `Edit` is hidden.
4. Outside the per-question block, after the pending question renderer, add a global action bar:
   ```js
   const draftCount = [...drafts.values()].filter((e) => e.status === 'draft').length;
   if (draftCount > 0) {
     html += '<div class="btn-group" style="position:sticky;bottom:0;background:var(--background);padding:1rem 0;">';
     html += '<button onclick="flushDrafts()" class="btn btn-primary">Send ' + draftCount + ' answer' + (draftCount === 1 ? '' : 's') + '</button>';
     html += '</div>';
   }
   ```
5. When the server sends `cancel`, also `drafts.delete(msg.id)` before re-rendering, to satisfy the contract's cancellation interplay rule.
6. Do NOT add any new wire message types. Phase 2 is out of scope.

**Verify:** `bun test tests/octto/ui/bundle-draft.test.ts`
**Commit:** `feat(octto): per-question draft + global send-N flow in browser bundle`

---

## Batch 5: End-to-end integration (parallel)

### Task 5.1: End-to-end test of shared server, ownership, and draft ordering

**File:** `tests/octto/integration/multi-conversation.test.ts`
**Test:** itself
**Depends:** 2.1, 2.2, 3.1, 3.2, 3.3
**Domain:** backend

Reasoning: One end-to-end backend test that boots the shared server, creates two Octto sessions under two different owners, and proves: each session has a distinct `/s/:id` URL on the same port; cross-owner tool calls return forbidden; a draft sent from a real WS client to session A's `/ws/:id` is received only by session A's waiter. This is the safety net that catches any drift between the contract and the implementation.

```typescript
// tests/octto/integration/multi-conversation.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { getSharedServer, stopSharedServer } from "@/octto/session/server";
import { createSessionStore } from "@/octto/session/sessions";

const askText = [{ type: "ask_text" as const, config: { question: "hi" } }];

describe("octto multi-conversation integration", () => {
  let store: ReturnType<typeof createSessionStore>;
  let port: number;

  beforeAll(async () => {
    store = createSessionStore({ skipBrowser: true });
    const handle = await getSharedServer(store, { port: 0 });
    port = handle.port;
  });

  afterAll(async () => {
    await store.cleanup();
    await stopSharedServer();
  });

  it("isolates two sessions on the same shared server", async () => {
    const a = await store.startSession({ ownerSessionID: "owner-A", questions: askText });
    const b = await store.startSession({ ownerSessionID: "owner-B", questions: askText });

    // Both fetch under the same port
    const resA = await fetch(`http://127.0.0.1:${port}/s/${a.session_id}`);
    const resB = await fetch(`http://127.0.0.1:${port}/s/${b.session_id}`);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    expect(store.isOwner(a.session_id, "owner-A")).toBe(true);
    expect(store.isOwner(a.session_id, "owner-B")).toBe(false);
    expect(store.isOwner(b.session_id, "owner-B")).toBe(true);
  });

  it("delivers a WS response only to the owning session's waiter", async () => {
    const a = await store.startSession({ ownerSessionID: "owner-A", questions: askText });
    const b = await store.startSession({ ownerSessionID: "owner-B", questions: askText });
    const aQid = [...(store.getSession(a.session_id)?.questions.keys() ?? [])][0] ?? "";
    const bQid = [...(store.getSession(b.session_id)?.questions.keys() ?? [])][0] ?? "";

    const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws/${a.session_id}`);
    await new Promise<void>((resolve) => { wsA.onopen = () => resolve(); });
    wsA.send(JSON.stringify({ type: "connected" }));
    wsA.send(JSON.stringify({ type: "response", id: aQid, answer: { text: "from A" } }));

    // Poll for A's question to be answered, with a generous timeout, without sleeping unnecessarily.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const sessA = store.getSession(a.session_id);
      const qa = sessA?.questions.get(aQid);
      if (qa?.status === "answered") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const sessA = store.getSession(a.session_id);
    const qa = sessA?.questions.get(aQid);
    expect(qa?.status).toBe("answered");

    // B's question is still pending
    const sessB = store.getSession(b.session_id);
    const qb = sessB?.questions.get(bQid);
    expect(qb?.status).toBe("pending");

    wsA.close();
  });
});
```

**Verify:** `bun test tests/octto/integration/multi-conversation.test.ts`
**Commit:** `test(octto): integration test for shared server multi-session isolation`

---

## Batch 6: Documentation (parallel)

### Task 6.1: Document the new env vars and behavior

**File:** `README.md`
**Test:** none
**Depends:** all prior batches (so the documented behavior matches the code)
**Domain:** general

Reasoning: The fork README should mention the new `OCTTO_PORT` and `OCTTO_PUBLIC_BASE_URL` env vars and note the session-scoped URL shape, because this is a user-visible change for anyone reverse-proxying Octto. Keep it short.

Action: append a `## Octto Configuration` section near the bottom (above `## Inspiration`). Required content:

```markdown
## Octto Configuration

Octto now runs a single shared HTTP server per OpenCode plugin process. Sessions are exposed on session-scoped URLs.

| Env var | Default | Effect |
|---------|---------|--------|
| `OCTTO_PORT` | `0` (Bun chooses a free port) | Port the shared Octto server binds to. |
| `OCTTO_PUBLIC_BASE_URL` | unset | URL prefix returned to agents when behind a reverse proxy. Trailing `/` is stripped. Example: `https://octto.wuxie233.com`. |

URL shape: each Octto session is reachable at `<base>/s/<sessionId>`; its WebSocket lives at `<base>/ws/<sessionId>` (auto-upgrades to `wss://` on HTTPS).

Multi-conversation safety: each Octto session is owned by the OpenCode conversation that called `start_session`. Tools called from a different conversation return a `## Forbidden` Markdown error and do not mutate state.

Draft-before-send: clicking a question's Submit in the browser stores a local draft. The browser only sends answers to the agent when you click `Send N answer(s)`. Each draft offers an `Edit` button until you send.
```

**Verify:** `bun run check`
**Commit:** `docs(octto): document shared server, ownership, and draft-before-send`

---

## Final verification (run after all batches)

```bash
bun run check
```

This runs Biome, ESLint, typecheck, and the full test suite. Do not run `bun run build` unless `bun run check` passes.

---

## Task Summary

| ID | File | Domain | One-line |
|----|------|--------|----------|
| 1.1 | src/octto/session/errors.ts | backend | OcttoForbiddenError tagged error |
| 1.2 | src/tools/octto/forbidden.ts | backend | formatForbidden Markdown helper |
| 1.3 | src/octto/session/index.ts | backend | re-export errors from session barrel |
| 1.4 | src/octto/session/types.ts | backend | add ownerSessionID, drop port/server |
| 2.1 | src/octto/session/server.ts | backend | shared `/s/:id` + `/ws/:id` server |
| 2.2 | src/octto/session/sessions.ts | backend | record owner, route through shared server, add ownership/listing helpers |
| 3.1 | src/tools/octto/session.ts | backend | guard start/end_session, record owner |
| 3.2 | src/tools/octto/factory.ts | backend | guard push_question + typed factory tools |
| 3.3 | src/tools/octto/responses.ts | backend | guard get/cancel/list tools |
| 4.1 | src/octto/ui/bundle.ts | frontend | session-scoped WS URL + draft + global Send N |
| 5.1 | tests/octto/integration/multi-conversation.test.ts | backend | end-to-end multi-session isolation test |
| 6.1 | README.md | general | document env vars and new flow |
