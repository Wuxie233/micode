import * as v from "valibot";

const MIN_STEPS = 1;
const MAX_STEPS = 16;
const TRIGGER_MAX_CHARS = 240;
const STEP_MAX_CHARS = 500;

export const CandidateStatusValues = ["pending", "approved", "rejected", "expired"] as const;
export const CandidateSourceKindValues = ["lifecycle_journal", "lifecycle_record", "ledger"] as const;
export const CandidateSensitivityValues = ["public", "internal"] as const;

export type CandidateStatus = (typeof CandidateStatusValues)[number];
export type CandidateSourceKind = (typeof CandidateSourceKindValues)[number];
export type CandidateSensitivity = (typeof CandidateSensitivityValues)[number];

export const CandidateSourceSchema = v.object({
  kind: v.picklist(CandidateSourceKindValues),
  pointer: v.pipe(v.string(), v.minLength(1)),
});

export const CandidateSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  projectId: v.pipe(v.string(), v.minLength(1)),
  trigger: v.pipe(v.string(), v.minLength(1), v.maxLength(TRIGGER_MAX_CHARS)),
  steps: v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(STEP_MAX_CHARS))),
    v.minLength(MIN_STEPS),
    v.maxLength(MAX_STEPS),
  ),
  sources: v.pipe(v.array(CandidateSourceSchema), v.minLength(1)),
  sensitivity: v.picklist(CandidateSensitivityValues),
  status: v.picklist(CandidateStatusValues),
  createdAt: v.number(),
  expiresAt: v.number(),
  hits: v.pipe(v.number(), v.minValue(0)),
});

export type Candidate = v.InferOutput<typeof CandidateSchema>;
export type CandidateSource = v.InferOutput<typeof CandidateSourceSchema>;

export type CandidateParseResult =
  | { readonly ok: true; readonly candidate: Candidate }
  | { readonly ok: false; readonly issues: readonly string[] };

export function parseCandidate(raw: unknown): CandidateParseResult {
  const result = v.safeParse(CandidateSchema, raw);
  if (result.success) return { ok: true, candidate: result.output };
  return { ok: false, issues: result.issues.map((issue) => issue.message) };
}
