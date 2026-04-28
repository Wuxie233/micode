import { $ } from "bun";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface LifecycleRunner {
  readonly git: (args: readonly string[], options?: { cwd?: string }) => Promise<RunResult>;
  readonly gh: (args: readonly string[], options?: { cwd?: string }) => Promise<RunResult>;
}

const LOG_MODULE = "lifecycle";
const GIT_BIN = "git";
const GH_BIN = "gh";
const EMPTY_OUTPUT = "";
const FAILURE_EXIT_CODE = 1;

async function runCommand(bin: string, args: readonly string[], cwd?: string): Promise<RunResult> {
  try {
    const tokens = [...args];
    const command = cwd ? $`${bin} ${tokens}`.cwd(cwd) : $`${bin} ${tokens}`;

    const completed = await command.quiet().nothrow();
    return {
      stdout: completed.stdout.toString(),
      stderr: completed.stderr.toString(),
      exitCode: completed.exitCode,
    };
  } catch (error) {
    const message = extractErrorMessage(error);
    log.warn(LOG_MODULE, `${bin} failed: ${message}`);
    return { stdout: EMPTY_OUTPUT, stderr: message, exitCode: FAILURE_EXIT_CODE };
  }
}

export function createLifecycleRunner(): LifecycleRunner {
  return {
    git: (args, options) => runCommand(GIT_BIN, args, options?.cwd),
    gh: (args, options) => runCommand(GH_BIN, args, options?.cwd),
  };
}
