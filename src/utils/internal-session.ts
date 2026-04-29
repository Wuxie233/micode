import type { PluginInput } from "@opencode-ai/plugin";

import { extractErrorMessage } from "@/utils/errors";
import { log as defaultLogger } from "@/utils/logger";

const LOG_MODULE = "internal-session";
const FIRST_DELETE_RETRY_BACKOFF_MS = 100;
const SECOND_DELETE_RETRY_BACKOFF_MS = 500;
const DELETE_RETRY_BACKOFFS_MS = [FIRST_DELETE_RETRY_BACKOFF_MS, SECOND_DELETE_RETRY_BACKOFF_MS] as const;
const SESSION_CREATE_FAILED = "internal session create returned no id";
const SESSION_CREATE_UNAVAILABLE = "ctx.client.session.create is unavailable";
const SESSION_DELETE_UNAVAILABLE = "ctx.client.session.delete is unavailable";
const UNKNOWN_AGENT = "unknown";

interface SessionCreateRequest {
  readonly body: {
    readonly title: string;
    readonly parentSessionID?: string;
    readonly internal?: boolean;
  };
  readonly query: { readonly directory: string };
}

interface SessionDeleteRequest {
  readonly path: { readonly id: string };
  readonly query: { readonly directory: string };
}

interface SessionCreateClient {
  readonly create: (request: SessionCreateRequest) => Promise<unknown>;
}

interface SessionDeleteClient {
  readonly delete: (request: SessionDeleteRequest) => Promise<unknown>;
}

interface Logger {
  readonly warn: (module: string, message: string) => void;
}

export interface CreateInternalSessionInput {
  readonly ctx: PluginInput;
  readonly title: string;
  readonly parentSessionId?: string;
}

export interface DeleteInternalSessionInput {
  readonly ctx: PluginInput;
  readonly sessionId: string | null;
  readonly agent?: string;
  readonly logger?: Logger;
  readonly sleep?: (ms: number) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasSessionCreate(session: unknown): session is SessionCreateClient {
  return isRecord(session) && typeof session.create === "function";
}

function hasSessionDelete(session: unknown): session is SessionDeleteClient {
  return isRecord(session) && typeof session.delete === "function";
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSessionId(response: unknown): string | null {
  if (!isRecord(response)) return null;
  const directId = nonEmpty(response.id);
  if (directId !== null) return directId;
  if (!isRecord(response.data)) return null;
  return nonEmpty(response.data.id);
}

function buildCreateRequest(input: CreateInternalSessionInput): SessionCreateRequest {
  const parentSessionId = nonEmpty(input.parentSessionId);
  if (parentSessionId === null) return { body: { title: input.title }, query: { directory: input.ctx.directory } };
  return {
    body: { title: input.title, parentSessionID: parentSessionId, internal: true },
    query: { directory: input.ctx.directory },
  };
}

function buildDeleteRequest(ctx: PluginInput, sessionId: string): SessionDeleteRequest {
  return { path: { id: sessionId }, query: { directory: ctx.directory } };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

async function attemptDelete(session: SessionDeleteClient, request: SessionDeleteRequest): Promise<Error | null> {
  try {
    await session.delete(request);
    return null;
  } catch (error) {
    return normalizeDeleteError(error);
  }
}

function normalizeDeleteError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(extractErrorMessage(error));
}

async function runDeleteAttempts(
  session: SessionDeleteClient,
  request: SessionDeleteRequest,
  sleep: (ms: number) => Promise<void>,
): Promise<Error | null> {
  let error = await attemptDelete(session, request);
  if (error === null) return null;

  for (const backoffMs of DELETE_RETRY_BACKOFFS_MS) {
    await sleep(backoffMs);
    error = await attemptDelete(session, request);
    if (error === null) return null;
  }

  return error;
}

function formatDeleteWarning(sessionId: string, agent: string | undefined, reason: unknown): string {
  return `Failed to delete internal session ${sessionId} for ${agent ?? UNKNOWN_AGENT}: ${extractErrorMessage(reason)}`;
}

function warnDeleteFailure(logger: Logger, sessionId: string, agent: string | undefined, reason: unknown): void {
  try {
    logger.warn(LOG_MODULE, formatDeleteWarning(sessionId, agent, reason));
  } catch {
    // Cleanup logging must not make deleteInternalSession throw.
  }
}

async function deleteExistingSession(
  input: DeleteInternalSessionInput,
  sessionId: string,
  logger: Logger,
): Promise<void> {
  const session: unknown = input.ctx.client.session;
  if (!hasSessionDelete(session)) {
    warnDeleteFailure(logger, sessionId, input.agent, SESSION_DELETE_UNAVAILABLE);
    return;
  }

  const request = buildDeleteRequest(input.ctx, sessionId);
  const error = await runDeleteAttempts(session, request, input.sleep ?? defaultSleep);
  if (error === null) return;
  warnDeleteFailure(logger, sessionId, input.agent, error);
}

export async function createInternalSession(
  input: CreateInternalSessionInput,
): Promise<{ readonly sessionId: string }> {
  const session: unknown = input.ctx.client.session;
  if (!hasSessionCreate(session)) throw new Error(SESSION_CREATE_UNAVAILABLE);

  const response = await session.create(buildCreateRequest(input));
  const sessionId = readSessionId(response);
  if (sessionId === null) throw new Error(SESSION_CREATE_FAILED);
  return { sessionId };
}

export async function deleteInternalSession(input: DeleteInternalSessionInput): Promise<void> {
  if (input.sessionId === null) return;

  const sessionId = input.sessionId;
  const logger = input.logger ?? defaultLogger;
  try {
    await deleteExistingSession(input, sessionId, logger);
  } catch (error) {
    warnDeleteFailure(logger, sessionId, input.agent, error);
  }
}

interface SessionUpdateRequest {
  readonly path: { readonly id: string };
  readonly body: { readonly title: string };
  readonly query: { readonly directory: string };
}

interface SessionUpdateClient {
  readonly update: (request: SessionUpdateRequest) => Promise<unknown>;
}

export interface UpdateInternalSessionInput {
  readonly ctx: PluginInput;
  readonly sessionId: string | null;
  readonly title: string;
  readonly logger?: Logger;
}

const SESSION_UPDATE_UNAVAILABLE = "ctx.client.session.update is unavailable";

function hasSessionUpdate(session: unknown): session is SessionUpdateClient {
  return isRecord(session) && typeof session.update === "function";
}

function formatUpdateWarning(sessionId: string, reason: unknown): string {
  return `Failed to update internal session ${sessionId} title: ${extractErrorMessage(reason)}`;
}

function warnUpdateFailure(logger: Logger, sessionId: string, reason: unknown): void {
  try {
    logger.warn(LOG_MODULE, formatUpdateWarning(sessionId, reason));
  } catch {
    // Logging must not make updateInternalSession throw.
  }
}

export async function updateInternalSession(input: UpdateInternalSessionInput): Promise<void> {
  if (input.sessionId === null) return;

  const trimmed = input.title.trim();
  if (trimmed.length === 0) return;

  const logger = input.logger ?? defaultLogger;
  const session: unknown = input.ctx.client.session;
  if (!hasSessionUpdate(session)) {
    warnUpdateFailure(logger, input.sessionId, SESSION_UPDATE_UNAVAILABLE);
    return;
  }

  try {
    await session.update({
      path: { id: input.sessionId },
      body: { title: trimmed },
      query: { directory: input.ctx.directory },
    });
  } catch (error) {
    warnUpdateFailure(logger, input.sessionId, error);
  }
}
