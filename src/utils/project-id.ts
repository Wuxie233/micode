import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { $ } from "bun";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const ID_LENGTH = 16;
const SSH_REMOTE_PATTERN = /^git@([^:]+):(.+)$/;
const TRAILING_GIT = /\.git$/;

export interface ProjectIdentity {
  readonly projectId: string;
  readonly kind: "origin" | "path";
  readonly source: string;
}

function hash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, ID_LENGTH);
}

function normalizeRemote(remote: string): string {
  const trimmed = remote.trim();
  const sshMatch = SSH_REMOTE_PATTERN.exec(trimmed);
  if (sshMatch) {
    const host = sshMatch[1].toLowerCase();
    const path = sshMatch[2].toLowerCase().replace(TRAILING_GIT, "");
    return `${host}/${path}`;
  }
  try {
    const url = new URL(trimmed);
    const host = url.host.toLowerCase();
    const path = url.pathname.toLowerCase().replace(/^\/+/, "").replace(TRAILING_GIT, "");
    return `${host}/${path}`;
  } catch {
    return trimmed.toLowerCase().replace(TRAILING_GIT, "");
  }
}

async function readOrigin(cwd: string): Promise<string | null> {
  try {
    const result = await $`git config --get remote.origin.url`.cwd(cwd).quiet();
    const text = result.stdout.toString().trim();
    return text.length > 0 ? text : null;
  } catch (error) {
    log.debug("project-id", `origin lookup failed: ${extractErrorMessage(error)}`);
    return null;
  }
}

async function readToplevel(cwd: string): Promise<string> {
  try {
    const result = await $`git rev-parse --show-toplevel`.cwd(cwd).quiet();
    const text = result.stdout.toString().trim();
    return text.length > 0 ? text : resolve(cwd);
  } catch {
    return resolve(cwd);
  }
}

export async function resolveProjectId(cwd: string): Promise<ProjectIdentity> {
  const origin = await readOrigin(cwd);
  if (origin) {
    const source = normalizeRemote(origin);
    return { projectId: hash(source), kind: "origin", source };
  }
  const toplevel = await readToplevel(cwd);
  return { projectId: hash(toplevel), kind: "path", source: toplevel };
}
