import type { ProjectIdentity } from "@/utils/project-id";
import type { ProjectMemoryStore } from "./store";

export type ForgetTarget =
  | { readonly kind: "project" }
  | { readonly kind: "entity"; readonly entityId: string }
  | { readonly kind: "entry"; readonly entryId: string }
  | { readonly kind: "source"; readonly sourceKind: string; readonly pointer: string };

export interface ForgetInput {
  readonly store: ProjectMemoryStore;
  readonly identity: ProjectIdentity;
  readonly target: ForgetTarget;
}

export interface ForgetOutcome {
  readonly removed: number;
  readonly target: ForgetTarget;
}

const ERR_UNSUPPORTED_TARGET = "Unsupported project memory forget target";

function unreachable(_target: never): never {
  throw new Error(ERR_UNSUPPORTED_TARGET);
}

export async function forget(input: ForgetInput): Promise<ForgetOutcome> {
  const projectId = input.identity.projectId;
  switch (input.target.kind) {
    case "project": {
      const entries = await input.store.countEntries(projectId);
      const entities = await input.store.countEntities(projectId);
      await input.store.forgetProject(projectId);
      return { removed: entries + entities, target: input.target };
    }
    case "entity": {
      await input.store.forgetEntity(projectId, input.target.entityId);
      return { removed: 1, target: input.target };
    }
    case "entry": {
      await input.store.forgetEntry(projectId, input.target.entryId);
      return { removed: 1, target: input.target };
    }
    case "source": {
      await input.store.forgetSource(projectId, input.target.sourceKind, input.target.pointer);
      return { removed: 1, target: input.target };
    }
  }
  return unreachable(input.target);
}
