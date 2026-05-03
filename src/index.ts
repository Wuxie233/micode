import { dirname, join } from "node:path";

import type { Plugin, PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { type ToolContext, tool } from "@opencode-ai/plugin/tool";
import type { McpLocalConfig } from "@opencode-ai/sdk";

import { agents, PRIMARY_AGENT_NAME } from "@/agents";
import { loadAvailableModels, loadMicodeConfig, loadModelContextLimits, mergeAgentConfigs } from "@/config-loader";
import {
  createArtifactAutoIndexHook,
  createAutoCompactHook,
  createCommentCheckerHook,
  createConstraintReviewerHook,
  createContextInjectorHook,
  createContextWindowMonitorHook,
  createConversationTitleHook,
  createFetchTrackerHook,
  createFileOpsTrackerHook,
  createFragmentInjectorHook,
  createLedgerLoaderHook,
  createMindmodelInjectorHook,
  createSessionRecoveryHook,
  createTokenAwareTruncationHook,
  getFileOps,
  warnUnknownAgents,
} from "@/hooks";
import { createProcedureInjectorHook } from "@/hooks/procedure-injector";
import { createLifecycleStore } from "@/lifecycle";
import { createJournalStore } from "@/lifecycle/journal/store";
import { createLeaseStore } from "@/lifecycle/lease/store";
import { createProgressLogger } from "@/lifecycle/progress";
import { createResolver } from "@/lifecycle/resolver";
import { createLifecycleRunner } from "@/lifecycle/runner";
import { createLifecycleStore as createLifecycleJsonStore } from "@/lifecycle/store";
import {
  type CompletionNotifier,
  createCourierSink,
  createDedupeStore,
  createNoopSink,
  createNotifier,
  createPolicy,
  type NotificationTarget,
} from "@/notifications";
import {
  type AutoResumeDispatcher,
  type ClientPromptRequest,
  createAutoResumeDispatcher,
} from "@/octto/auto-resume/dispatcher";
import { buildContinuePrompt } from "@/octto/auto-resume/prompt";
import { type AutoResumeRegistry, createAutoResumeRegistry } from "@/octto/auto-resume/registry";
import {
  createPersistedSessionStore,
  createPersistenceListener,
  type PersistenceListener,
  type ReconcileReport,
  reconcilePersistedSessions,
} from "@/octto/persistence";
import { type SessionListeners, safelyInvoke } from "@/octto/session/listeners";
import type { Session } from "@/octto/session/types";
import { runMiner } from "@/skill-evolution/miner-runner";
import { createCandidateStore } from "@/skill-evolution/store";
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
import { createLifecycleTools } from "@/tools/lifecycle";
import { createResumeSubagentTool } from "@/tools/resume-subagent";
import { createSkillsTools } from "@/tools/skills";
import {
  createPreservedRegistryOver,
  createSpawnAgentTool,
  createSpawnSessionRegistry,
  type PreservedRegistry,
  type SpawnAgentToolOptions,
  type SpawnSessionRegistry,
} from "@/tools/spawn-agent";
import { cleanupGeneration } from "@/tools/spawn-agent/cleanup";
import { verifyMarker } from "@/tools/spawn-agent/verifier";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { createInternalSession, deleteInternalSession } from "@/utils/internal-session";
import { log } from "@/utils/logger";
import { type ModelReference, parseModelReference } from "@/utils/model-selection";
import { resolveProjectId } from "@/utils/project-id";

// Think mode: detect keywords and enable extended thinking
const THINK_KEYWORDS = [
  /\bthink\s*(hard|deeply|carefully|through)\b/i,
  /\bthink\b.*\b(about|on|through)\b/i,
  /\b(deeply|carefully)\s*think\b/i,
  /\blet('s|s)?\s*think\b/i,
];

function detectThinkKeyword(text: string): boolean {
  return THINK_KEYWORDS.some((pattern) => pattern.test(text));
}

// MCP server configurations
const MCP_SERVERS: Record<string, McpLocalConfig> = {
  context7: {
    type: "local",
    command: ["npx", "-y", "@upstash/context7-mcp@latest"],
  },
};

// Environment-gated research MCP servers
if (process.env.PERPLEXITY_API_KEY) {
  MCP_SERVERS.perplexity = {
    type: "local",
    command: ["npx", "-y", "@anthropic/mcp-perplexity"],
  };
}

if (process.env.FIRECRAWL_API_KEY) {
  MCP_SERVERS.firecrawl = {
    type: "local",
    command: ["npx", "-y", "firecrawl-mcp"],
  };
}

const PLUGIN_COMMANDS = {
  init: {
    description: "Initialize project with ARCHITECTURE.md and CODE_STYLE.md",
    agent: "project-initializer",
    template: "Initialize this project. $ARGUMENTS",
  },
  mindmodel: {
    description: "Generate .mindmodel/ constraints for this project",
    agent: "mm-orchestrator",
    template: "Generate mindmodel for this project. $ARGUMENTS",
  },
  ledger: {
    description: "Create or update continuity ledger for session state",
    agent: "ledger-creator",
    template: "Update the continuity ledger. $ARGUMENTS",
  },
  search: {
    description: "Search past handoffs, plans, and ledgers",
    agent: "artifact-searcher",
    template: "Search for: $ARGUMENTS",
  },
  memory: {
    description: "Inspect or query durable project memory (entities, decisions, lessons, risks)",
    agent: PRIMARY_AGENT_NAME,
    template:
      "Use the project_memory_* tools to handle this request. Default behaviour: if no arguments are given, run project_memory_health and report a concise summary; if arguments are given, run project_memory_lookup with the arguments as the query. $ARGUMENTS",
  },
  skills: {
    description: "Review pending skill candidates (list/approve/reject)",
    agent: PRIMARY_AGENT_NAME,
    template:
      "Use skills_list to show pending skill candidates. If arguments include 'approve <id>' or 'reject <id> <reason>' run skills_approve or skills_reject. $ARGUMENTS",
  },
};

const PERSIST_START_LABEL = "persist.start";
const PERSIST_PUSH_LABEL = "persist.push";
const PERSIST_ANSWERED_LABEL = "persist.answered";
const PERSIST_END_LABEL = "persist.end";
const AUTO_RESUME_LABEL = "autoresume";
const PERSISTENCE_LOG_SCOPE = "octto.persistence";
const INTERNAL_SESSION_CREATE_NO_ID = "internal session create returned no id";
const REVIEW_SKIPPED_RESPONSE = '{"status": "PASS", "violations": [], "summary": "Review skipped"}';
const REVIEW_EMPTY_RESPONSE = '{"status": "PASS", "violations": [], "summary": "Empty response"}';
const REVIEW_FAILED_RESPONSE = '{"status": "PASS", "violations": [], "summary": "Review failed"}';
const SPAWN_VERIFIER_AGENT = "spawn-agent.verifier";
const CLEANUP_PARENT_RUN_REASON = "superseded";
const CLEANUP_GENERATION_MIN = 1;
const CLEANUP_GENERATION_MAX = 10;

interface OcttoListenerInput {
  readonly persistenceListener: PersistenceListener;
  readonly autoResumeRegistry: AutoResumeRegistry;
  readonly autoResumeDispatcher: AutoResumeDispatcher;
}

interface AutoResumeClientAdapter {
  readonly session: {
    readonly prompt: (request: ClientPromptRequest) => Promise<unknown>;
  };
}

interface MessagePart {
  readonly type: string;
  readonly text?: string;
}

interface SessionMessage {
  readonly info?: { readonly role?: string };
  readonly parts?: readonly MessagePart[];
}

interface SessionMessagesResponse {
  readonly data?: readonly SessionMessage[];
}

interface ReleasableHandle {
  readonly unref?: () => void;
}

function extractTextFromParts(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text" && "text" in p)
    .map((p) => (p as { text: string }).text)
    .join("");
}

function isMissingInternalSessionId(error: unknown): boolean {
  return extractErrorMessage(error) === INTERNAL_SESSION_CREATE_NO_ID;
}

function dispatchAutoResume(input: OcttoListenerInput, session: Session, questionId: string): void {
  const owner = input.autoResumeRegistry.lookup(session.id);
  if (!owner) return;

  safelyInvoke(
    AUTO_RESUME_LABEL,
    () =>
      void input.autoResumeDispatcher.handle({
        conversationId: session.id,
        ownerSessionId: owner,
        questionId,
        answeredAt: Date.now(),
      }),
  );
}

function createOcttoListeners(input: OcttoListenerInput): SessionListeners {
  return {
    onSessionStarted: (session) => {
      safelyInvoke(PERSIST_START_LABEL, () => void input.persistenceListener.onSessionStarted(session));
    },
    onQuestionPushed: (session) => {
      safelyInvoke(PERSIST_PUSH_LABEL, () => void input.persistenceListener.onQuestionPushed(session));
    },
    onQuestionAnswered: (session, questionId) => {
      safelyInvoke(PERSIST_ANSWERED_LABEL, () => void input.persistenceListener.onQuestionAnswered(session));
      dispatchAutoResume(input, session, questionId);
    },
    onSessionEnded: (sessionId) => {
      safelyInvoke(PERSIST_END_LABEL, () => void input.persistenceListener.onSessionEnded(sessionId));
      input.autoResumeRegistry.unregister(sessionId);
    },
  };
}

function logReconcileReport(report: ReconcileReport): void {
  log.info(
    PERSISTENCE_LOG_SCOPE,
    `Reconciled persisted sessions: loaded=${report.loaded}, expired=${report.expired}, skippedInvalid=${report.skippedInvalid}`,
  );
}

function releaseInterval(handle: ReturnType<typeof setInterval>): void {
  const candidate = handle as ReleasableHandle;
  candidate.unref?.();
}

function startResumeSweep(registry: PreservedRegistry): void {
  const handle = setInterval(() => {
    registry.sweep(Date.now());
  }, config.subagent.resumeSweepIntervalMs);
  releaseInterval(handle);
}

function readAssistantText(messages: readonly SessionMessage[]): string {
  const assistant = messages.filter((message) => message.info?.role === "assistant").pop();
  return (
    assistant?.parts
      ?.filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

function buildVerifierPromptBody(prompt: string): {
  readonly parts: { readonly type: "text"; readonly text: string }[];
  readonly model?: ModelReference;
} {
  const model = parseModelReference(config.model.default);
  const body = { parts: [{ type: "text" as const, text: prompt }] };
  return model ? { ...body, model } : body;
}

async function runVerifierClassification(ctx: PluginInput, prompt: string): Promise<string> {
  const session = await createInternalSession({ ctx, title: SPAWN_VERIFIER_AGENT });
  try {
    await ctx.client.session.prompt({
      path: { id: session.sessionId },
      body: buildVerifierPromptBody(prompt),
      query: { directory: ctx.directory },
    });
    const response = (await ctx.client.session.messages({
      path: { id: session.sessionId },
      query: { directory: ctx.directory },
    })) as SessionMessagesResponse;
    return readAssistantText(response.data ?? []);
  } finally {
    await deleteInternalSession({ ctx, sessionId: session.sessionId, agent: SPAWN_VERIFIER_AGENT });
  }
}

function buildRealVerifier(ctx: PluginInput): SpawnAgentToolOptions["verifier"] {
  if (!config.subagent.markerVerification.enabled) return undefined;
  const deps = {
    timeoutMs: config.subagent.markerVerification.timeoutMs,
    maxOutputChars: config.subagent.markerVerification.maxOutputChars,
  };
  return (input) =>
    verifyMarker(input, { ...deps, runClassification: (prompt) => runVerifierClassification(ctx, prompt) });
}

function collectGenerations(registry: SpawnSessionRegistry, ownerSessionId: string, runId: string): readonly number[] {
  const generations = new Set<number>();
  for (const record of registry.listPreserved()) {
    if (record.ownerSessionId !== ownerSessionId || record.runId !== runId) continue;
    generations.add(record.generation);
  }
  for (let generation = CLEANUP_GENERATION_MIN; generation <= CLEANUP_GENERATION_MAX; generation += 1) {
    generations.add(generation);
  }
  return [...generations].sort((left, right) => left - right);
}

function createCleanupParentRunTool(ctx: PluginInput, registry: SpawnSessionRegistry): ToolDefinition {
  return tool({
    description:
      "Best-effort cleanup of orphaned subagent sessions from a prior executor generation. " +
      "Call before re-dispatching after a confirmed executor crash.",
    args: {
      run_id: tool.schema.string().min(1).describe("The previous executor's run id (its session id)"),
      reason: tool.schema.string().optional().describe("Free-form reason; defaults to 'superseded'"),
    },
    execute: async (args, toolCtx) => {
      const ownerSessionId = ((toolCtx as ToolContext & { readonly sessionID?: string }).sessionID ?? "").trim();
      const reason = args.reason && args.reason.length > 0 ? args.reason : CLEANUP_PARENT_RUN_REASON;
      const generations = collectGenerations(registry, ownerSessionId, args.run_id);
      const summary = { aborted: 0, deleted: 0, failures: [] as string[] };
      for (const generation of generations) {
        const result = await cleanupGeneration({
          ctx,
          registry,
          ownerSessionId,
          runId: args.run_id,
          generation,
          reason,
        });
        summary.aborted += result.aborted;
        summary.deleted += result.deleted;
        summary.failures.push(...result.failures.map((failure) => `${failure.sessionId}: ${failure.error}`));
      }
      return [
        "## cleanup_parent_run Result",
        "",
        `**Run**: ${args.run_id}`,
        `**Reason**: ${reason}`,
        `**Aborted**: ${summary.aborted}`,
        `**Deleted**: ${summary.deleted}`,
        `**Failures**: ${summary.failures.length === 0 ? "none" : summary.failures.join("; ")}`,
      ].join("\n");
    },
  });
}

function createAutoResumeClient(client: PluginInput["client"]): AutoResumeClientAdapter {
  return {
    session: {
      prompt: (request: ClientPromptRequest) =>
        Promise.resolve(
          client.session.prompt({
            path: request.path,
            body: { parts: request.body.parts.map((part) => ({ type: part.type, text: part.text })) },
          }),
        ),
    },
  };
}

const NOTIFICATION_COURIER_AGENT = "notification-courier";
const NOTIFICATION_COURIER_TITLE = "notification-courier";

function buildCourierPrompt(target: NotificationTarget, message: string): string {
  if (target.kind === "group") {
    return `Call autoinfo_send_qq_notification with group_id="${target.groupId}" and the following message exactly:\n\n${message}`;
  }
  return `Call autoinfo_send_qq_notification with user_id="${target.userId}" and the following message exactly:\n\n${message}`;
}

function buildCourierInvoke(ctx: PluginInput): (target: NotificationTarget, message: string) => Promise<void> {
  return async (target, message) => {
    let sessionId: string | undefined;
    try {
      const created = await createInternalSession({ ctx, title: NOTIFICATION_COURIER_TITLE });
      sessionId = created.sessionId;
      await ctx.client.session.prompt({
        path: { id: sessionId },
        body: {
          agent: NOTIFICATION_COURIER_AGENT,
          tools: {},
          parts: [{ type: "text", text: buildCourierPrompt(target, message) }],
        },
      });
    } catch (error) {
      log.warn("notifications", `courier session failed: ${extractErrorMessage(error)}`);
    } finally {
      if (sessionId) {
        await deleteInternalSession({ ctx, sessionId, agent: NOTIFICATION_COURIER_AGENT }).catch((error: unknown) => {
          log.warn("notifications", `courier session delete failed: ${extractErrorMessage(error)}`);
        });
      }
    }
  };
}

function buildCompletionNotifier(ctx: PluginInput): CompletionNotifier {
  const policyConfig = {
    enabled: config.notifications.enabled,
    qqUserId: config.notifications.qqUserId,
    qqGroupId: config.notifications.qqGroupId,
    maxSummaryChars: config.notifications.maxSummaryChars,
    dedupeTtlMs: config.notifications.dedupeTtlMs,
    dedupeMaxEntries: config.notifications.dedupeMaxEntries,
  };
  const dedupe = createDedupeStore({
    ttlMs: policyConfig.dedupeTtlMs,
    maxEntries: policyConfig.dedupeMaxEntries,
  });
  const sink = config.notifications.enabled ? createCourierSink({ invoke: buildCourierInvoke(ctx) }) : createNoopSink();
  return createNotifier({
    config: policyConfig,
    sink,
    policy: createPolicy({ config: policyConfig, dedupe }),
  });
}

// eslint-disable-next-line max-lines-per-function
const OpenCodeConfigPlugin: Plugin = async (ctx) => {
  // Validate external tool dependencies at startup
  const astGrepStatus = await checkAstGrepAvailable();
  if (!astGrepStatus.available) {
    log.warn("micode", astGrepStatus.message ?? "ast-grep unavailable");
  }

  const btcaStatus = await checkBtcaAvailable();
  if (!btcaStatus.available) {
    log.warn("micode", btcaStatus.message ?? "btca unavailable");
  }

  // Load user config for agent overrides and feature flags
  const userConfig = await loadMicodeConfig();

  // Load model context limits from opencode.json
  const modelContextLimits = loadModelContextLimits();
  const availableModels = loadAvailableModels();

  // Think mode state per session
  const thinkModeState = new Map<string, boolean>();
  const lastUserTextBySession = new Map<string, string>();

  // Hooks
  const autoCompactHook = createAutoCompactHook(ctx, {
    compactionThreshold: userConfig?.compactionThreshold,
    modelContextLimits,
  });
  const contextInjectorHook = createContextInjectorHook(ctx);
  const ledgerLoaderHook = createLedgerLoaderHook(ctx);
  const sessionRecoveryHook = createSessionRecoveryHook(ctx);
  const tokenAwareTruncationHook = createTokenAwareTruncationHook(ctx);
  const contextWindowMonitorHook = createContextWindowMonitorHook(ctx, { modelContextLimits });
  const commentCheckerHook = createCommentCheckerHook(ctx);
  const artifactAutoIndexHook = createArtifactAutoIndexHook(ctx);
  const fileOpsTrackerHook = createFileOpsTrackerHook(ctx);
  const fetchTrackerHook = createFetchTrackerHook(ctx);

  // Fragment injector hook - injects user-defined prompt fragments
  const fragmentInjectorHook = createFragmentInjectorHook(ctx, userConfig);

  // Warn about unknown agent names in fragments config
  if (userConfig?.fragments) {
    const knownAgentNames = new Set(Object.keys(agents));
    const fragmentAgentNames = Object.keys(userConfig.fragments);
    const warnings = warnUnknownAgents(fragmentAgentNames, knownAgentNames);
    for (const warning of warnings) {
      log.warn("micode", warning);
    }
  }

  // Track internal sessions to prevent hook recursion (used by reviewer)
  const internalSessions = new Set<string>();

  // Conversation title hook - keeps the main agent's session title in sync with milestone events
  const conversationTitleHook = createConversationTitleHook(ctx, {
    chatFallbackEnabled: userConfig?.features?.conversationTitleChatFallback === true,
    isInternalSession: (sessionID) => internalSessions.has(sessionID),
  });

  // Mindmodel injector hook - matches tasks to patterns via keywords and injects them
  // Feature-flagged: set features.mindmodelInjection=true in micode.json to enable
  const mindmodelInjectorHook = userConfig?.features?.mindmodelInjection ? createMindmodelInjectorHook(ctx) : null;

  // Mindmodel lookup tool - agents call this when they need coding patterns
  const mindmodelLookupTool = createMindmodelLookupTool(ctx);
  const projectMemoryTools = {
    ...createProjectMemoryLookupTool(ctx),
    ...createProjectMemoryPromoteTool(ctx),
    ...createProjectMemoryHealthTool(ctx),
    ...createProjectMemoryForgetTool(ctx),
  };
  const candidateStore = createCandidateStore();
  const skillsTools = createSkillsTools(ctx, { candidateStore });
  const skillEvolutionEnabled = userConfig?.features?.skillEvolution === true;
  const procedureInjectorHook = skillEvolutionEnabled
    ? createProcedureInjectorHook(ctx, {
        enabled: true,
        lastUserText: (sessionID) => lastUserTextBySession.get(sessionID) ?? "",
      })
    : null;

  // Constraint reviewer hook - reviews generated code against .mindmodel/ constraints
  const constraintReviewerHook = createConstraintReviewerHook(ctx, async (reviewPrompt) => {
    let sessionId: string | undefined;
    try {
      const created = await createInternalSession({ ctx, title: "constraint-reviewer" });
      sessionId = created.sessionId;

      // Mark as internal to prevent hook recursion
      internalSessions.add(sessionId);

      const promptResult = await ctx.client.session.prompt({
        path: { id: sessionId },
        body: {
          agent: "mm-constraint-reviewer",
          tools: {},
          parts: [{ type: "text", text: reviewPrompt }],
        },
      });

      if (!promptResult.data?.parts) {
        return REVIEW_EMPTY_RESPONSE;
      }

      return extractTextFromParts(promptResult.data.parts);
    } catch (error) {
      if (isMissingInternalSessionId(error)) {
        log.warn("mindmodel", "Failed to create reviewer session");
        return REVIEW_SKIPPED_RESPONSE;
      }
      log.warn("mindmodel", `Reviewer failed: ${extractErrorMessage(error)}`);
      return REVIEW_FAILED_RESPONSE;
    } finally {
      if (sessionId) {
        internalSessions.delete(sessionId);
        await deleteInternalSession({ ctx, sessionId, agent: "constraint-reviewer" });
      }
    }
  });

  // PTY System - load bun-pty with graceful degradation
  // Sets BUN_PTY_LIB env var to fix path resolution in OpenCode plugin environments
  // See: https://github.com/vtemian/micode/issues/20
  const ptyManager = createPTYManager();
  const bunPty = await loadBunPty();
  if (bunPty) {
    ptyManager.init(bunPty.spawn);
  }
  const ptyTools = ptyManager.available ? createPtyTools(ptyManager) : {};

  const spawnRegistry: SpawnSessionRegistry = createSpawnSessionRegistry({
    maxResumes: config.subagent.maxResumesPerSession,
    ttlHours: config.subagent.failedSessionTtlHours,
    runningTtlMs: config.subagent.spawnRegistryRunningTtlMs,
  });
  const preservedRegistry = createPreservedRegistryOver(spawnRegistry, {
    maxResumes: config.subagent.maxResumesPerSession,
    ttlHours: config.subagent.failedSessionTtlHours,
  });
  startResumeSweep(preservedRegistry);

  // Spawn agent tool (for subagents to spawn other subagents)
  const spawn_agent = createSpawnAgentTool(ctx, {
    registry: preservedRegistry,
    spawnRegistry,
    availableModels,
    verifier: buildRealVerifier(ctx),
  });
  const resume_subagent = createResumeSubagentTool(ctx, { registry: preservedRegistry });
  const cleanup_parent_run = createCleanupParentRunTool(ctx, spawnRegistry);

  // Batch read tool (for parallel file reads)
  const batch_read = createBatchReadTool(ctx);

  const lifecycleBaseDir = join(ctx.directory, config.lifecycle.lifecycleDir);
  const lifecycleJournal = createJournalStore({ baseDir: lifecycleBaseDir });
  const lifecycleLease = createLeaseStore({ baseDir: lifecycleBaseDir });
  const lifecycleResolver = createResolver({
    runner: createLifecycleRunner(),
    store: createLifecycleJsonStore({ baseDir: lifecycleBaseDir }),
    cwd: ctx.directory,
  });
  const lifecycleProgress = createProgressLogger({
    runner: createLifecycleRunner(),
    resolver: lifecycleResolver,
    cwd: ctx.directory,
  });
  const completionNotifier = buildCompletionNotifier(ctx);
  const lifecycleHandle = createLifecycleStore({
    runner: createLifecycleRunner(),
    worktreesRoot: dirname(ctx.directory),
    cwd: ctx.directory,
    progress: lifecycleProgress,
    journal: lifecycleJournal,
    lease: lifecycleLease,
    notifier: completionNotifier,
  });
  const lifecycleTools = createLifecycleTools(lifecycleHandle, lifecycleResolver, lifecycleProgress);

  // Octto (browser-based brainstorming) tools
  const persistedSessionStore = createPersistedSessionStore({});
  const persistenceListener = createPersistenceListener({ persistedStore: persistedSessionStore });
  const autoResumeRegistry = createAutoResumeRegistry();
  const autoResumeDispatcher = createAutoResumeDispatcher({
    client: createAutoResumeClient(ctx.client),
    registry: autoResumeRegistry,
    buildPrompt: buildContinuePrompt,
  });
  const octtoSessionStore = createSessionStore({
    listeners: createOcttoListeners({ persistenceListener, autoResumeRegistry, autoResumeDispatcher }),
  });
  const reconcileReport = await reconcilePersistedSessions({
    store: octtoSessionStore,
    persistedStore: persistedSessionStore,
  });
  logReconcileReport(reconcileReport);

  // Track octto sessions per opencode session for cleanup
  const octtoSessions = new Map<string, Set<string>>();

  const octtoTools = createOcttoTools(octtoSessionStore, ctx.client, {
    onCreated: (parentSessionId, octtoSessionId) => {
      const sessions = octtoSessions.get(parentSessionId) ?? new Set<string>();
      sessions.add(octtoSessionId);
      octtoSessions.set(parentSessionId, sessions);
      autoResumeRegistry.register(octtoSessionId, parentSessionId);
    },
    onEnded: (parentSessionId, octtoSessionId) => {
      autoResumeRegistry.unregister(octtoSessionId);
      const sessions = octtoSessions.get(parentSessionId);
      if (!sessions) return;
      sessions.delete(octtoSessionId);
      if (sessions.size === 0) {
        octtoSessions.delete(parentSessionId);
      }
    },
  });

  async function cleanupDeletedSession(event: { properties?: unknown }): Promise<void> {
    const props = event.properties as { info?: { id?: string } } | undefined;
    if (!props?.info?.id) return;

    const sessionId = props.info.id;
    thinkModeState.delete(sessionId);
    lastUserTextBySession.delete(sessionId);
    ptyManager.cleanupBySession(sessionId);
    constraintReviewerHook.cleanupSession(sessionId);
    fetchTrackerHook.cleanupSession(sessionId);

    // Cleanup octto sessions
    const sessionOcttoIds = octtoSessions.get(sessionId);
    if (sessionOcttoIds) {
      for (const octtoSessionId of sessionOcttoIds) {
        await octtoSessionStore.endSession(octtoSessionId).catch((_e: unknown) => {
          /* fire-and-forget */
        });
      }
      octtoSessions.delete(sessionId);
    }
  }

  async function runSkillEvolutionMiner(): Promise<void> {
    const resolved = await lifecycleResolver.current();
    if (resolved.kind !== "resolved") return;

    const identity = await resolveProjectId(ctx.directory);
    const summary = await runMiner({
      cwd: ctx.directory,
      projectId: identity.projectId,
      issueNumber: resolved.record.issueNumber,
      now: Date.now(),
      candidateStore,
    });
    log.info(
      "skill-evolution",
      `miner ran: added=${summary.candidatesAdded} skipped=${summary.candidatesSkipped} rejected=${summary.rejected}`,
    );
  }

  return {
    // Tools
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
      ...mindmodelLookupTool,
      ...projectMemoryTools,
      ...skillsTools,
      ...ptyTools,
      ...octtoTools,
      ...lifecycleTools,
    },

    config: async (config) => {
      // Allow all permissions globally - no prompts
      config.permission = {
        ...config.permission,
        edit: "allow",
        bash: "allow",
        webfetch: "allow",
        external_directory: "allow",
      };

      // Merge user config overrides into plugin agents
      const mergedAgents = mergeAgentConfigs(agents, userConfig, availableModels);

      // Add our agents - our agents override OpenCode defaults, demote built-in build/plan to subagent
      config.agent = {
        ...config.agent, // OpenCode defaults first
        build: { ...config.agent?.build, mode: "subagent" },
        plan: { ...config.agent?.plan, mode: "subagent" },
        triage: { ...config.agent?.triage, mode: "subagent" },
        docs: { ...config.agent?.docs, mode: "subagent" },
        // Our agents override - spread these LAST so they take precedence
        ...Object.fromEntries(Object.entries(mergedAgents).filter(([k]) => k !== PRIMARY_AGENT_NAME)),
        [PRIMARY_AGENT_NAME]: mergedAgents[PRIMARY_AGENT_NAME],
      };

      // Add MCP servers (plugin servers override defaults)
      config.mcp = {
        ...config.mcp,
        ...MCP_SERVERS,
      };

      // Add commands
      config.command = { ...config.command, ...PLUGIN_COMMANDS };
    },

    "chat.message": async (input, output) => {
      // Extract text from user message
      const text = output.parts
        .filter((p) => p.type === "text" && "text" in p)
        .map((p) => (p as { text: string }).text)
        .join(" ");

      if (skillEvolutionEnabled && text.trim().length > 0) {
        lastUserTextBySession.set(input.sessionID, text);
      }

      // Track if think mode was requested
      thinkModeState.set(input.sessionID, detectThinkKeyword(text));

      // Check for override command
      await constraintReviewerHook["chat.message"](input, output);

      // Update conversation title from the very first user message of a new session
      await conversationTitleHook["chat.message"](input, output);
    },

    "chat.params": async (input, output) => {
      // Inject user-defined fragments FIRST (highest priority, beginning of prompt)
      await fragmentInjectorHook["chat.params"](input, output);

      // Inject ledger context (high priority)
      await ledgerLoaderHook["chat.params"](input, output);

      // Inject project context files
      await contextInjectorHook["chat.params"](input, output);

      // Inject context window status
      await contextWindowMonitorHook["chat.params"](input, output);

      if (procedureInjectorHook) {
        await procedureInjectorHook["chat.params"](input, output);
      }

      // If think mode was requested, increase thinking budget
      if (thinkModeState.get(input.sessionID)) {
        output.options = {
          ...output.options,
          thinking: {
            type: "enabled",
            budgetTokens: config.thinking.budgetTokens,
          },
        };
      }
    },

    // Structured compaction prompt (Factory.ai / pi-mono best practices)
    "experimental.session.compacting": async (
      input: { sessionID: string },
      output: { context: string[]; prompt?: string },
    ) => {
      // Get file operations for this session
      const fileOps = getFileOps(input.sessionID);
      const readPaths = Array.from(fileOps.read).sort();
      const modifiedPaths = Array.from(fileOps.modified).sort();

      const fileOpsSection = `
## File Operations
### Read
${readPaths.length > 0 ? readPaths.map((p) => `- \`${p}\``).join("\n") : "- (none)"}

### Modified
${modifiedPaths.length > 0 ? modifiedPaths.map((p) => `- \`${p}\``).join("\n") : "- (none)"}`;

      output.prompt = `Create a structured summary for continuing this conversation. Use this EXACT format:

# Session Summary

## Goal
{The core objective being pursued - one sentence describing success criteria}

## Constraints & Preferences
{Technical requirements, patterns to follow, things to avoid - or "(none)"}

## Progress
### Done
- [x] {Completed items with specific details}

### In Progress
- [ ] {Current work - what's actively being worked on}

### Blocked
- {Issues preventing progress, if any - or "(none)"}

## Key Decisions
- **{Decision}**: {Rationale - why this choice was made}

## Next Steps
1. {Ordered list of what to do next - be specific}

## Critical Context
- {Data, examples, references, or findings needed to continue work}
- {Important discoveries or insights from this session}
${fileOpsSection}

IMPORTANT:
- Preserve EXACT file paths and function names
- Focus on information needed to continue seamlessly
- Be specific about what was done, not vague summaries
- Include any error messages or issues encountered`;
    },

    // Tool output processing
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
      output: { output?: string },
    ) => {
      // Token-aware truncation
      await tokenAwareTruncationHook["tool.execute.after"]({ name: input.tool, sessionID: input.sessionID }, output);

      // Comment checker for Edit tool
      await commentCheckerHook["tool.execute.after"]({ tool: input.tool, args: input.args }, output);

      // Directory-aware context injection for Read/Edit
      await contextInjectorHook["tool.execute.after"]({ tool: input.tool, args: input.args }, output);

      // Auto-index artifacts when written to thoughts/ directories
      await artifactAutoIndexHook["tool.execute.after"]({ tool: input.tool, args: input.args }, output);

      // Track file operations for ledger
      await fileOpsTrackerHook["tool.execute.after"](
        { tool: input.tool, sessionID: input.sessionID, args: input.args },
        output,
      );

      // Track fetch operations and cache results
      await fetchTrackerHook["tool.execute.after"](
        { tool: input.tool, sessionID: input.sessionID, args: input.args },
        output,
      );

      // Constraint review for Edit/Write
      await constraintReviewerHook["tool.execute.after"](
        { tool: input.tool, sessionID: input.sessionID, args: input.args },
        output,
      );

      // Update conversation title on milestone tool events (lifecycle, plan write, executor spawn)
      await conversationTitleHook["tool.execute.after"](
        { tool: input.tool, sessionID: input.sessionID, args: input.args },
        output,
      );
    },

    // Transform messages: match task keywords and prepare mindmodel injection
    "experimental.chat.messages.transform": async (input, output) => {
      if (!mindmodelInjectorHook) return;
      // Skip internal sessions (reviewer)
      const sessionID = (input as { sessionID?: string }).sessionID;
      if (sessionID && internalSessions.has(sessionID)) return;

      await mindmodelInjectorHook["experimental.chat.messages.transform"](input, output);
    },

    // Transform system prompt: filter CLAUDE.md/AGENTS.md + inject mindmodel
    "experimental.chat.system.transform": async (input, output) => {
      // Filter out CLAUDE.md/AGENTS.md from system prompt for our agents
      output.system = output.system.filter((s) => {
        // Keep entries that don't come from CLAUDE.md or AGENTS.md
        if (s.startsWith("Instructions from:")) {
          const path = s.split("\n")[0];
          if (path.includes("CLAUDE.md") || path.includes("AGENTS.md")) {
            return false;
          }
        }
        return true;
      });

      // Inject mindmodel patterns into system prompt (if enabled)
      if (mindmodelInjectorHook && input.sessionID) {
        await mindmodelInjectorHook["experimental.chat.system.transform"](
          input as typeof input & { sessionID: string },
          output,
        );
      }
    },

    event: async ({ event }) => {
      // Session cleanup (think mode + PTY + octto + constraint reviewer)
      if (event.type === "session.deleted") {
        await cleanupDeletedSession(event);
        if (skillEvolutionEnabled) {
          void runSkillEvolutionMiner().catch((error: unknown) => {
            log.warn("skill-evolution", `miner trigger skipped: ${extractErrorMessage(error)}`);
          });
        }
      }

      // Run all event hooks
      await autoCompactHook.event({ event });
      await sessionRecoveryHook.event({ event });
      await tokenAwareTruncationHook.event({ event });
      await contextWindowMonitorHook.event({ event });

      // File ops tracker cleanup
      await fileOpsTrackerHook.event({ event });

      // Fetch tracker cleanup
      await fetchTrackerHook.event({ event });

      // Conversation title cleanup
      await conversationTitleHook.event({ event });
    },
  };
};

export { OpenCodeConfigPlugin };
