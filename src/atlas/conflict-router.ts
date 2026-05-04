import { isDismissed } from "./challenge-dedup";
import { writeChallenge } from "./challenge-writer";
import { computeClaimHash } from "./claim-hash";
import { ATLAS_CHALLENGE_CAP_PER_RUN } from "./config";

export interface ConflictInput {
  readonly target: string;
  readonly reason: string;
  readonly proposedChange: string;
  readonly sources: readonly string[];
}

export interface RouteResult {
  readonly written: readonly string[];
  readonly deferred: readonly string[];
  readonly skippedDueToDedup: number;
}

export async function routeConflicts(
  projectRoot: string,
  runId: string,
  conflicts: readonly ConflictInput[],
): Promise<RouteResult> {
  const written: string[] = [];
  const deferred: string[] = [];
  let skipped = 0;
  for (const conflict of conflicts) {
    if (written.length >= ATLAS_CHALLENGE_CAP_PER_RUN) {
      deferred.push(conflict.target);
      continue;
    }
    const claimHash = computeClaimHash(conflict.target, conflict.reason);
    if (isDismissed(projectRoot, conflict.target, claimHash)) {
      skipped += 1;
      continue;
    }
    const file = await writeChallenge(projectRoot, { ...conflict, runId });
    written.push(file);
  }
  return { written, deferred, skippedDueToDedup: skipped };
}
