import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { type PersistedSession, parsePersistedSession } from "./schemas";

export interface PersistedSessionStoreOptions {
  readonly baseDir?: string;
}

export interface PersistedSessionStore {
  readonly save: (session: PersistedSession) => Promise<void>;
  readonly load: (sessionId: string) => Promise<PersistedSession | null>;
  readonly delete: (sessionId: string) => Promise<void>;
  readonly list: () => Promise<readonly string[]>;
}

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const JSON_SUFFIX = ".json";
const JSON_INDENT = 2;
const LOG_SCOPE = "octto.persistence";

const validateSessionId = (sessionId: string): void => {
  if (SESSION_ID_PATTERN.test(sessionId)) return;
  throw new Error(`Invalid session ID: ${sessionId}`);
};

const toSessionId = (entry: string): string => entry.slice(0, -JSON_SUFFIX.length);

const parseSession = (content: string, location: string): PersistedSession | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    log.warn(LOG_SCOPE, `Malformed persisted session JSON: ${location}: ${extractErrorMessage(error)}`);
    return null;
  }

  const parsed = parsePersistedSession(raw);
  if (parsed.ok) return parsed.session;

  log.warn(LOG_SCOPE, `Invalid persisted session schema: ${location}`);
  return null;
};

export function createPersistedSessionStore(options: PersistedSessionStoreOptions = {}): PersistedSessionStore {
  const baseDir = options.baseDir ?? config.octto.persistedSessionsDir;

  const ensureDir = (): void => {
    if (existsSync(baseDir)) return;
    mkdirSync(baseDir, { recursive: true });
  };

  const getPath = (sessionId: string): string => {
    validateSessionId(sessionId);
    return join(baseDir, `${sessionId}${JSON_SUFFIX}`);
  };

  return {
    async save(session: PersistedSession): Promise<void> {
      ensureDir();
      const location = getPath(session.session_id);
      await Bun.write(location, JSON.stringify(session, null, JSON_INDENT));
    },

    async load(sessionId: string): Promise<PersistedSession | null> {
      const location = getPath(sessionId);
      if (!existsSync(location)) return null;

      const content = await Bun.file(location).text();
      return parseSession(content, location);
    },

    async delete(sessionId: string): Promise<void> {
      const location = getPath(sessionId);
      rmSync(location, { force: true });
    },

    async list(): Promise<readonly string[]> {
      if (!existsSync(baseDir)) return [];

      return readdirSync(baseDir)
        .filter((entry) => entry.endsWith(JSON_SUFFIX))
        .map(toSessionId)
        .filter((sessionId) => SESSION_ID_PATTERN.test(sessionId))
        .sort();
    },
  };
}
