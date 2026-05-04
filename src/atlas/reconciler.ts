export interface WorkerClaim {
  readonly target: string;
  readonly claim: string;
}

export interface WorkerOutput {
  readonly worker: string;
  readonly claims: readonly WorkerClaim[];
}

export interface AgreedClaim {
  readonly target: string;
  readonly claim: string;
  readonly workers: readonly string[];
}

export interface ConflictRecord {
  readonly target: string;
  readonly reason: string;
  readonly proposedChange: string;
  readonly sources: readonly string[];
}

export interface ReconcileResult {
  readonly agreed: readonly AgreedClaim[];
  readonly conflicts: readonly ConflictRecord[];
}

type ClaimsByText = Map<string, string[]>;
type ClaimEntry = readonly [string, string[]];

const CONFLICT_REASON = "Workers disagreed about this node";

const claimBucketFor = (targets: Map<string, ClaimsByText>, target: string): ClaimsByText => {
  const existing = targets.get(target);
  if (existing) return existing;
  const claims = new Map<string, string[]>();
  targets.set(target, claims);
  return claims;
};

const addClaim = (claims: ClaimsByText, worker: string, claim: string): void => {
  const workers = claims.get(claim) ?? [];
  workers.push(worker);
  claims.set(claim, workers);
};

const collectClaims = (outputs: readonly WorkerOutput[]): Map<string, ClaimsByText> => {
  const targets = new Map<string, ClaimsByText>();
  for (const output of outputs) {
    for (const claim of output.claims) addClaim(claimBucketFor(targets, claim.target), output.worker, claim.claim);
  }
  return targets;
};

const appendAgreedClaims = (agreed: AgreedClaim[], target: string, entries: readonly ClaimEntry[]): void => {
  for (const [claim, workers] of entries) {
    if (entries.length !== 1 && workers.length <= 1) continue;
    agreed.push({ target, claim, workers });
  }
};

const createConflict = (target: string, entries: readonly ClaimEntry[]): ConflictRecord => {
  const summaries = entries.map(([claim, workers]) => `- "${claim}" (${workers.join(", ")})`);
  return { target, reason: CONFLICT_REASON, proposedChange: summaries.join("\n"), sources: [] };
};

export function reconcileWorkerOutput(outputs: readonly WorkerOutput[]): ReconcileResult {
  const targets = collectClaims(outputs);
  const agreed: AgreedClaim[] = [];
  const conflicts: ConflictRecord[] = [];
  for (const [target, claims] of targets) {
    const entries = Array.from(claims.entries());
    appendAgreedClaims(agreed, target, entries);
    if (entries.length <= 1) continue;
    conflicts.push(createConflict(target, entries));
  }
  return { agreed, conflicts };
}
