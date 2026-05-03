import type { PluginInput } from "@opencode-ai/plugin";

import { type LookupHit, lookup } from "@/project-memory";
import { planProcedureInjection } from "@/skill-evolution/inject-plan";
import { getIdentity, getStore } from "@/tools/project-memory/runtime";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { ProjectIdentity } from "@/utils/project-id";

const LOG_SCOPE = "skill-evolution.injector";
const DEFAULT_QUERY = "";
const SKIPPED_PREFIX = "injection skipped";

export interface ProcedureInjectorOptions {
  readonly enabled: boolean;
  readonly lastUserText?: (sessionID: string) => string;
  readonly identityOverride?: ProjectIdentity;
  readonly lookupProcedures?: (query: string, identity: ProjectIdentity) => Promise<readonly LookupHit[]>;
}

interface ChatParamsHook {
  "chat.params": (
    input: { sessionID: string },
    output: { system?: string; options?: Record<string, unknown> },
  ) => Promise<void>;
}

async function defaultLookup(query: string, identity: ProjectIdentity): Promise<readonly LookupHit[]> {
  const store = await getStore();
  return lookup({
    store,
    identity,
    query,
    type: "procedure",
    status: "tentative",
    sensitivityCeiling: config.skillEvolution.injectionSensitivityCeiling,
    limit: config.skillEvolution.maxInjectedProcedures,
  });
}

export function createProcedureInjectorHook(ctx: PluginInput, options: ProcedureInjectorOptions): ChatParamsHook {
  const lookupProcedures = options.lookupProcedures ?? defaultLookup;
  const readQuery = options.lastUserText ?? (() => DEFAULT_QUERY);

  return {
    "chat.params": async (input, output) => {
      if (!options.enabled) return;

      try {
        const query = readQuery(input.sessionID);
        if (query.trim().length === 0) return;

        const identity = options.identityOverride ?? (await getIdentity(ctx.directory));
        const hits = await lookupProcedures(query, identity);
        const block = planProcedureInjection({
          enabled: true,
          maxInjectedProcedures: config.skillEvolution.maxInjectedProcedures,
          injectionCharBudget: config.skillEvolution.injectionCharBudget,
          snippetMaxChars: config.skillEvolution.snippetMaxChars,
          hits,
        });
        if (!block) return;

        output.system = output.system ? `${output.system}${block}` : block;
      } catch (error) {
        log.warn(LOG_SCOPE, `${SKIPPED_PREFIX}: ${extractErrorMessage(error)}`);
      }
    },
  };
}
