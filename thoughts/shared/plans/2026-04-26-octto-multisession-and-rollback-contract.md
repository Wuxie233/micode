# Octto Multi-Session and Draft-Before-Send Interface Contract

**Status:** frozen (implementers and reviewers MUST conform; changes require user approval)

**Scope:** Phase 1 only.

- Phase 1 in scope: shared HTTP/WS server with session-scoped URLs; ownership guard on every tool call; UI client-side draft + edit-before-send.
- Phase 2 (NOT in this contract): deep rollback of already-sent answers (especially answers consumed by brainstorm/probe loops). Phase 2 is intentionally deferred.

The contract below freezes the cross-domain interfaces between the backend (Bun HTTP/WS server, session store, Octto tools) and the frontend (browser UI bundle).

---

## HTTP Endpoints

The server is single, shared, and process-wide. It is bound once per OpenCode plugin process and serves all Octto sessions for that process.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/s/:sessionId` | none (loopback by default) | Serve the bundled Octto HTML for the given session. The HTML is static; the only session-specific data is the URL itself. |
| GET | `/s/:sessionId/` | none | Same as above; trailing slash allowed. |
| GET | `/healthz` | none | Returns `200 OK` with body `ok` for liveness checks. |
| GET | any other path | none | Returns `404 Not Found`. |

**Removed routes:** the previous unscoped routes `/`, `/index.html`, and `/ws` are removed. Requests to `/` or `/index.html` MUST return `404 Not Found` and a body that explains the new shape: `Octto requires a session-scoped URL: /s/:sessionId`.

**Unknown sessionId:** `GET /s/:sessionId` for an unknown sessionId MUST return `404 Not Found` with body `Unknown Octto session: <sessionId>`. The bundle is NOT served in that case.

---

## WebSocket URL and Upgrade

| Method | Path | Description |
|--------|------|-------------|
| WS upgrade | `/ws/:sessionId` | Upgrade an HTTP request to a WebSocket bound to the given session. |

**URL construction (frontend):**

```js
const sessionId = window.__OCTTO_SESSION_ID__; // injected by backend into bundle
const wsScheme = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${wsScheme}//${window.location.host}/ws/${sessionId}`;
```

The backend MUST inject the sessionId into the served HTML by replacing a literal placeholder so the bundle source itself does not need to know any sessionId at build time. The agreed mechanism is:

- Bundle contains literal token `__OCTTO_SESSION_ID_PLACEHOLDER__` in a `<script>` block.
- `GET /s/:sessionId` replaces the first occurrence of that token with the JSON-encoded sessionId before responding.

**Behavior:**

- Upgrade for an unknown sessionId MUST be rejected with `404 Not Found` (do NOT upgrade then close).
- Upgrade for a known sessionId succeeds; the upgraded socket carries `data.sessionId` in `ServerWebSocket<WsData>`.
- Only one connected client per session is tracked at a time. If a second client connects, the previous `wsClient` reference is replaced; the old socket is left open but no longer routed to.

---

## WebSocket Message Schemas

All messages are JSON. `type` is the discriminant.

### Server -> Client

```ts
interface WsQuestionMessage {
  readonly type: "question";
  readonly id: string;            // questionId
  readonly questionType: QuestionType;
  readonly config: BaseConfig;
}

interface WsCancelMessage {
  readonly type: "cancel";
  readonly id: string;            // questionId being cancelled by the agent
}

interface WsEndMessage {
  readonly type: "end";
}

type WsServerMessage = WsQuestionMessage | WsCancelMessage | WsEndMessage;
```

These are unchanged from the existing implementation.

### Client -> Server

```ts
interface WsConnectedMessage {
  readonly type: "connected";
}

interface WsResponseMessage {
  readonly type: "response";
  readonly id: string;            // questionId
  readonly answer: Record<string, unknown>;
}

type WsClientMessage = WsConnectedMessage | WsResponseMessage;
```

**Frontend ordering rule (Phase 1 draft-before-send):**

The frontend MUST NOT send a `WsResponseMessage` at the moment the user clicks a per-question Submit button. It MUST first store the answer locally as a `draft`. It only sends `WsResponseMessage` once the user clicks the global `Send N answers` action. Once sent, the draft is marked `sent` and `Edit` is disabled for that question.

The backend treats receipt of `WsResponseMessage` as a single atomic event: it transitions the question from `pending` to `answered` and notifies waiters. Phase 1 does not introduce any "unsend" message.

**Schema validation:** The backend continues to validate every inbound client message with Valibot (`WsClientMessageSchema`) and rejects unknown shapes with the existing error envelope.

---

## Session-Scoped URL Returned to the Agent

`start_session` returns a Markdown summary that includes the session URL. The URL MUST be one of:

1. If `config.octto.publicBaseUrl` is non-empty: `${publicBaseUrl}/s/${sessionId}`
2. Else: `http://${bindHost}:${port}/s/${sessionId}` where `bindHost` is `127.0.0.1` (or the configured bind address) and `port` is the actual port the shared server bound to.

`publicBaseUrl` MUST have any trailing `/` stripped before composing the URL (already enforced by `readOcttoPublicBaseUrl` in `src/utils/config.ts`).

`createServer` is renamed in semantics, not in name strictly: it now returns a process-wide singleton server. Implementers MUST ensure the server is started lazily on first `startSession` and reused for all subsequent sessions in the same process.

---

## Ownership Guard

Every Octto MCP tool that takes a `session_id` or a `question_id` MUST verify that the caller owns the targeted Octto session before doing any work.

**Owner identity:** `context.sessionID` from the OpenCode tool execution context. This is the parent OpenCode conversation's session ID and is distinct from the Octto session ID.

**Recording ownership:** `start_session` records `ownerSessionID = context.sessionID` on the new Octto session at creation time. Once set, it is immutable.

**Tools that require an ownership check:**

- `start_session` — sets ownership; no prior owner check needed.
- `end_session` — owner must match.
- `push_question` — owner must match.
- `get_answer` — owner of the Octto session that owns `question_id` must match.
- `get_next_answer` — owner of the Octto session must match.
- `cancel_question` — owner of the Octto session that owns `question_id` must match.
- `list_questions` — when `session_id` is provided, owner must match. When `session_id` is omitted, the tool MUST scope its listing to sessions owned by `context.sessionID` only.
- All 16 typed question tools created via `createQuestionTool` (pick_one, pick_many, confirm, ask_text, ask_image, ask_file, ask_code, show_diff, show_plan, show_options, review_section, thumbs, slider, rank, rate, emoji_react) — owner must match.
- All brainstorm tools (`create_brainstorm`, `await_brainstorm_complete`, `get_brainstorm_summary`, `end_brainstorm`) — they create or operate on an Octto session under the hood; ownership is recorded at creation and checked on every subsequent call.

**Failure response:**

When the ownership check fails, the tool MUST return a Markdown error string of exactly this shape and MUST NOT mutate any session state:

```
## Forbidden

Session <octtoSessionId> belongs to a different OpenCode conversation. Each OpenCode conversation owns its own Octto sessions.

Hint: call start_session in this conversation to get a session_id you own.
```

When the targeted session/question does not exist at all, the existing not-found error path is kept (e.g., `Failed to end session <id>. It may not exist.`). Not-found takes precedence over forbidden so that information about other conversations' session IDs is not leaked.

**Internal API (backend-only, not exposed to the LLM):**

```ts
interface SessionStore {
  // existing methods...

  /** Throws OcttoForbiddenError if ownerSessionID does not match. */
  assertOwner(octtoSessionId: string, ownerSessionID: string): void;

  /** Returns true iff the given OpenCode session owns the given Octto session. */
  isOwner(octtoSessionId: string, ownerSessionID: string): boolean;

  /** List all Octto session IDs owned by the given OpenCode session. */
  listOwnedSessions(ownerSessionID: string): string[];
}
```

`OcttoForbiddenError` is a tagged error class exported from `@/octto/session`. Tools catch it and convert it to the Markdown response above; they do not let it propagate.

---

## Shared Types (Phase 1 additions)

Added to `src/octto/session/types.ts`:

```ts
export interface Session {
  readonly id: string;
  readonly title?: string;
  readonly url: string;
  readonly createdAt: Date;
  readonly questions: Map<string, Question>;
  readonly ownerSessionID: string;          // NEW: parent OpenCode session ID
  wsConnected: boolean;
  wsClient?: ServerWebSocket<unknown>;
  // NOTE: per-session `port` and `server` fields are removed; the server is process-wide.
}

export interface StartSessionInput {
  readonly title?: string;
  readonly questions?: InitialQuestion[];
  readonly ownerSessionID: string;          // NEW: required at creation time
}
```

`StartSessionOutput` is unchanged in shape.

---

## Frontend Draft State Model (Phase 1)

The bundle MUST track local UI state separately from server-confirmed state:

```ts
type DraftStatus = "none" | "draft" | "sent";

interface DraftEntry {
  readonly questionId: string;
  status: DraftStatus;
  /** The answer payload the user composed; shape matches the WS response answer for the question type. */
  answer?: Record<string, unknown>;
}
```

**State transitions (frontend-only, not over the wire):**

- `none -> draft`: user clicks per-question `Submit` (or equivalent: pick_one/pick_many `Submit`, ask_text `Submit`, etc.). The UI saves the composed answer into `DraftEntry` and shows the question card in `draft` mode with two actions: `Edit` and a card-level indicator that this answer is queued.
- `draft -> none`: user clicks `Edit`. The answer is cleared back to the input controls; the draft entry becomes `none`.
- `draft -> draft` (overwrite): user edits then re-submits. New answer overwrites the prior draft for the same question.
- `draft -> sent`: triggered only by the global `Send N answers` action. The UI sends one `WsResponseMessage` per drafted question, then marks each `sent`. Once `sent`, `Edit` MUST be disabled and the answer is treated as committed.

**Global Send action:**

- Visible whenever at least one question has status `draft`.
- Label: `Send N answer(s)` where N is the count of draft entries.
- On click: iterate drafts in stable order (creation order of the question), send each as a `WsResponseMessage`, mark each `sent`. The UI MUST debounce against double-clicks during the send loop.

**Cancellation interplay:**

- If the server sends a `cancel` for a questionId that has a local `draft`, the draft MUST be discarded and the question removed from the visible queue, matching existing behavior.
- If the server sends a `cancel` for a questionId already `sent`, the answer was already received and answered; the cancel is a no-op for the UI (and in practice the backend rejects it because the question is no longer pending).

**Phase 2 deferral note (informational, not part of the wire contract):**

- Phase 2 will introduce an explicit unsend / rollback message for already-sent answers. Phase 1 implementers MUST NOT add such a message; if they need it, they escalate.

---

## Configuration (env)

| Env var | Default | Effect |
|---------|---------|--------|
| `OCTTO_PORT` | `0` (Bun chooses a free port) | Port the shared Octto server binds to. |
| `OCTTO_PUBLIC_BASE_URL` | `""` (empty) | When non-empty, used as the URL prefix returned to agents. Trailing `/` stripped. Example: `https://octto.wuxie233.com`. |
| `OCTTO_BIND_ADDRESS` (informational) | `127.0.0.1` (`config.octto.bindAddress`) | Existing config field; not introduced by this plan but used by the shared server. `allowRemoteBind=true` in code switches to the configured bind address. |

The example deploy target is `https://octto.wuxie233.com` reverse-proxied to the local Bun server. With `publicBaseUrl=https://octto.wuxie233.com`, the agent receives `https://octto.wuxie233.com/s/<sessionId>`; the browser then connects WS to `wss://octto.wuxie233.com/ws/<sessionId>`.

---

## Backwards Compatibility

- Tools' tool-call shapes (names, args, return text) are unchanged except that some failures now return the `## Forbidden` Markdown error.
- WS message types and JSON shapes are unchanged except for the URL path.
- `Session.port` and `Session.server` are removed from the public type; if any caller imports them, the planner has flagged that as a forbidden import. Implementers fix any such caller as part of the relevant task.
- The browser bundle still loads the IBM Plex Mono font and `marked` from CDNs; only the connection logic and the post-Submit flow change.

---

## Error Code Conventions (tool layer)

| Situation | Tool response shape |
|-----------|---------------------|
| Session not found | Existing not-found Markdown (e.g., `Failed to end session <id>. It may not exist.`). |
| Question not found | Existing not-found Markdown. |
| Ownership mismatch | The `## Forbidden` Markdown above. |
| Validation failure (existing) | Existing `Failed: <reason>` Markdown. |
| Internal error (existing) | Existing `Failed: <extractErrorMessage>` Markdown. |

Not-found takes precedence over forbidden so cross-conversation IDs are not enumerable.

---

## Self-Check

Before handing off to the executor, the planner has verified:

- Every backend route created (`/s/:sessionId`, `/ws/:sessionId`, `/healthz`) appears in the HTTP Endpoints / WS sections above.
- Every URL the frontend constructs (HTML location, `wsUrl`) corresponds to one of those routes.
- The frontend's draft-state model has no message types beyond what the WS section already lists; no new wire messages are introduced.
- Every tool that touches an Octto session ID or question ID is enumerated under "Tools that require an ownership check".
- Phase 2 (deep rollback of sent answers) is explicitly out of scope and not referenced by any task in the plan.
