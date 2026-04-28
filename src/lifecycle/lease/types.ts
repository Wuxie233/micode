export interface LeaseRecord {
  readonly issueNumber: number;
  readonly owner: string;
  readonly host: string;
  readonly branch: string;
  readonly worktree: string;
  readonly acquiredAt: number;
  readonly heartbeatAt: number;
  readonly ttlMs: number;
}

export interface LeaseAcquireInput {
  readonly issueNumber: number;
  readonly owner: string;
  readonly host: string;
  readonly branch: string;
  readonly worktree: string;
  readonly ttlMs: number;
}

export type LeaseAcquireOutcome =
  | { readonly kind: "acquired"; readonly lease: LeaseRecord }
  | { readonly kind: "held"; readonly current: LeaseRecord }
  | { readonly kind: "expired_stolen"; readonly lease: LeaseRecord; readonly previous: LeaseRecord };
