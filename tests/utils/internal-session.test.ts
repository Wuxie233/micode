import { describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createInternalSession, deleteInternalSession } from "@/utils/internal-session";

const TEST_DIRECTORY = "/tmp/micode-test-project";
const TEST_TITLE = "internal worker";
const TEST_SESSION_ID = "session-123";
const TEST_PARENT_SESSION_ID = "parent-456";
const TEST_AGENT = "reviewer";
const CREATE_FAILURE_MESSAGE = "create failed";
const DELETE_FAILURE_MESSAGE = "delete failed";
const FIRST_BACKOFF_MS = 100;
const SECOND_BACKOFF_MS = 500;

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

interface TestContextOptions {
  readonly create?: (request: SessionCreateRequest) => Promise<unknown>;
  readonly delete?: (request: SessionDeleteRequest) => Promise<unknown>;
}

interface TestLogger {
  readonly warnings: string[];
  readonly warn: (module: string, message: string) => void;
}

function createTestContext(options: TestContextOptions = {}): PluginInput {
  return {
    directory: TEST_DIRECTORY,
    client: {
      session: {
        create: options.create ?? (async (): Promise<unknown> => ({ data: { id: TEST_SESSION_ID } })),
        delete: options.delete ?? (async (): Promise<unknown> => ({ data: {} })),
      },
    },
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

function createSleep(delays: number[]): (ms: number) => Promise<void> {
  return async (ms: number): Promise<void> => {
    delays.push(ms);
  };
}

describe("internal session utilities", () => {
  describe("createInternalSession", () => {
    it("calls session.create with title and directory", async () => {
      const calls: SessionCreateRequest[] = [];
      const ctx = createTestContext({
        create: async (request): Promise<unknown> => {
          calls.push(request);
          return { data: { id: TEST_SESSION_ID } };
        },
      });

      const created = await createInternalSession({ ctx, title: TEST_TITLE });

      expect(created).toEqual({ sessionId: TEST_SESSION_ID });
      expect(calls).toEqual([{ body: { title: TEST_TITLE }, query: { directory: TEST_DIRECTORY } }]);
    });

    it("includes parentSessionID and internal flag when supplied", async () => {
      const calls: SessionCreateRequest[] = [];
      const ctx = createTestContext({
        create: async (request): Promise<unknown> => {
          calls.push(request);
          return { data: { id: TEST_SESSION_ID } };
        },
      });

      await createInternalSession({ ctx, title: TEST_TITLE, parentSessionId: TEST_PARENT_SESSION_ID });

      expect(calls[0]?.body).toEqual({ title: TEST_TITLE, parentSessionID: TEST_PARENT_SESSION_ID, internal: true });
    });

    it("throws when SDK returns no session id", async () => {
      const ctx = createTestContext({
        create: async (): Promise<unknown> => ({ data: {} }),
      });

      await expect(createInternalSession({ ctx, title: TEST_TITLE })).rejects.toThrow(
        "internal session create returned no id",
      );
    });

    it("propagates SDK errors", async () => {
      const sdkError = new Error(CREATE_FAILURE_MESSAGE);
      const ctx = createTestContext({
        create: async (): Promise<unknown> => {
          throw sdkError;
        },
      });

      await expect(createInternalSession({ ctx, title: TEST_TITLE })).rejects.toBe(sdkError);
    });
  });

  describe("deleteInternalSession", () => {
    it("does nothing for null", async () => {
      const calls: SessionDeleteRequest[] = [];
      const ctx = createTestContext({
        delete: async (request): Promise<unknown> => {
          calls.push(request);
          return { data: {} };
        },
      });

      await deleteInternalSession({ ctx, sessionId: null });

      expect(calls).toEqual([]);
    });

    it("succeeds first attempt", async () => {
      const calls: SessionDeleteRequest[] = [];
      const ctx = createTestContext({
        delete: async (request): Promise<unknown> => {
          calls.push(request);
          return { data: {} };
        },
      });

      await deleteInternalSession({ ctx, sessionId: TEST_SESSION_ID });

      expect(calls).toEqual([{ path: { id: TEST_SESSION_ID }, query: { directory: TEST_DIRECTORY } }]);
    });

    it("retries twice then succeeds with injected sleep", async () => {
      const delays: number[] = [];
      const calls: SessionDeleteRequest[] = [];
      const ctx = createTestContext({
        delete: async (request): Promise<unknown> => {
          calls.push(request);
          if (calls.length < 3) throw new Error(DELETE_FAILURE_MESSAGE);
          return { data: {} };
        },
      });

      await deleteInternalSession({ ctx, sessionId: TEST_SESSION_ID, sleep: createSleep(delays) });

      expect(calls).toHaveLength(3);
      expect(delays).toEqual([FIRST_BACKOFF_MS, SECOND_BACKOFF_MS]);
    });

    it("logs warning and resolves when all retries fail, message contains session and agent", async () => {
      const logger = createLogger();
      const ctx = createTestContext({
        delete: async (): Promise<unknown> => {
          throw new Error(DELETE_FAILURE_MESSAGE);
        },
      });

      await deleteInternalSession({
        ctx,
        sessionId: TEST_SESSION_ID,
        agent: TEST_AGENT,
        logger,
        sleep: createSleep([]),
      });

      expect(logger.warnings).toHaveLength(1);
      expect(logger.warnings[0]).toContain(TEST_SESSION_ID);
      expect(logger.warnings[0]).toContain(TEST_AGENT);
      expect(logger.warnings[0]).toContain(DELETE_FAILURE_MESSAGE);
    });

    it("never throws on delete failure", async () => {
      const logger = createLogger();
      const ctx = createTestContext({
        delete: async (): Promise<unknown> => {
          throw new Error(DELETE_FAILURE_MESSAGE);
        },
      });

      await expect(
        deleteInternalSession({ ctx, sessionId: TEST_SESSION_ID, logger, sleep: createSleep([]) }),
      ).resolves.toBe(undefined);
    });
  });
});
