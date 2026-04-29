import { describe, expect, it, mock } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { updateInternalSession } from "@/utils/internal-session";

const SESSION_ID = "session_abc";
const DIRECTORY = "/tmp/repo";
const NEW_TITLE = "执行中: 修复后端权限校验";
const PADDED_TITLE = `  ${NEW_TITLE}  `;
const TRANSPORT_FAILURE = "transport failure";

interface SessionUpdateRequest {
  readonly path: { readonly id: string };
  readonly body: { readonly title: string };
  readonly query: { readonly directory: string };
}

interface TestLogger {
  readonly warnings: string[];
  readonly warn: (module: string, message: string) => void;
}

function createCtx(update: (request: SessionUpdateRequest) => Promise<unknown>): PluginInput {
  return {
    client: { session: { update } },
    directory: DIRECTORY,
  } as unknown as PluginInput;
}

function createLogger(): TestLogger {
  const warnings: string[] = [];
  return {
    warnings,
    warn: (_module: string, message: string): void => {
      warnings.push(message);
    },
  };
}

describe("updateInternalSession", () => {
  it("calls session.update with session id and trimmed title", async () => {
    const update = mock(async (_request: SessionUpdateRequest): Promise<unknown> => ({}));
    const ctx = createCtx(update);

    await updateInternalSession({ ctx, sessionId: SESSION_ID, title: PADDED_TITLE });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toEqual({
      path: { id: SESSION_ID },
      body: { title: NEW_TITLE },
      query: { directory: DIRECTORY },
    });
  });

  it("does nothing when session id is null", async () => {
    const update = mock(async (_request: SessionUpdateRequest): Promise<unknown> => ({}));
    const ctx = createCtx(update);

    await updateInternalSession({ ctx, sessionId: null, title: NEW_TITLE });

    expect(update).not.toHaveBeenCalled();
  });

  it("resolves and warns when session.update rejects", async () => {
    const logger = createLogger();
    const update = mock(async (_request: SessionUpdateRequest): Promise<unknown> => {
      throw new Error(TRANSPORT_FAILURE);
    });
    const ctx = createCtx(update);

    await expect(
      updateInternalSession({ ctx, sessionId: SESSION_ID, title: NEW_TITLE, logger }),
    ).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain(SESSION_ID);
    expect(logger.warnings[0]).toContain(TRANSPORT_FAILURE);
  });

  it("resolves and warns when session.update is missing", async () => {
    const logger = createLogger();
    const ctx = { client: { session: {} }, directory: DIRECTORY } as unknown as PluginInput;

    await expect(
      updateInternalSession({ ctx, sessionId: SESSION_ID, title: NEW_TITLE, logger }),
    ).resolves.toBeUndefined();

    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain(SESSION_ID);
    expect(logger.warnings[0]).toContain("ctx.client.session.update is unavailable");
  });

  it("does nothing when title trims to empty", async () => {
    const update = mock(async (_request: SessionUpdateRequest): Promise<unknown> => ({}));
    const ctx = createCtx(update);

    await updateInternalSession({ ctx, sessionId: SESSION_ID, title: "   " });

    expect(update).not.toHaveBeenCalled();
  });
});
