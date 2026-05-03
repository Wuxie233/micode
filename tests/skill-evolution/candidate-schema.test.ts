import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import {
  CandidateSchema,
  CandidateSensitivityValues,
  CandidateSourceKindValues,
  CandidateStatusValues,
  parseCandidate,
} from "@/skill-evolution/candidate-schema";

describe("skill-evolution CandidateSchema", () => {
  const valid = {
    id: "cand_abc123",
    projectId: "proj_1",
    trigger: "On lifecycle finish that promotes a ledger",
    steps: ["Read ledger", "Run extractCandidates", "Upsert entry"],
    sources: [
      { kind: "lifecycle_journal" as const, pointer: "thoughts/lifecycle/24.journal.jsonl" },
      { kind: "ledger" as const, pointer: "thoughts/ledgers/CONTINUITY_2026-05-03.md" },
    ],
    sensitivity: "internal" as const,
    status: "pending" as const,
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_000_000 + 1000,
    hits: 1,
  };

  it("accepts a complete candidate", () => {
    const result = v.safeParse(CandidateSchema, valid);
    expect(result.success).toBe(true);
  });

  it("rejects an empty trigger", () => {
    const result = v.safeParse(CandidateSchema, { ...valid, trigger: "" });
    expect(result.success).toBe(false);
  });

  it("rejects zero steps", () => {
    const result = v.safeParse(CandidateSchema, { ...valid, steps: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than the maximum number of steps", () => {
    const tooMany = Array.from({ length: 17 }, (_, i) => `step ${i}`);
    const result = v.safeParse(CandidateSchema, { ...valid, steps: tooMany });
    expect(result.success).toBe(false);
  });

  it("rejects unknown status", () => {
    const result = v.safeParse(CandidateSchema, { ...valid, status: "weird" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown source kind", () => {
    const result = v.safeParse(CandidateSchema, {
      ...valid,
      sources: [{ kind: "design", pointer: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects sensitivity 'secret' (candidates must not store secrets)", () => {
    const result = v.safeParse(CandidateSchema, { ...valid, sensitivity: "secret" });
    expect(result.success).toBe(false);
  });

  it("CandidateStatusValues lists pending, approved, rejected, expired", () => {
    expect([...CandidateStatusValues].sort()).toEqual(["approved", "expired", "pending", "rejected"]);
  });

  it("CandidateSourceKindValues lists lifecycle_journal, lifecycle_record, ledger", () => {
    expect([...CandidateSourceKindValues].sort()).toEqual(["ledger", "lifecycle_journal", "lifecycle_record"]);
  });

  it("CandidateSensitivityValues lists public and internal only", () => {
    expect([...CandidateSensitivityValues].sort()).toEqual(["internal", "public"]);
  });

  it("parseCandidate returns ok=true with the parsed candidate on valid input", () => {
    const result = parseCandidate(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candidate.id).toBe("cand_abc123");
  });

  it("parseCandidate returns ok=false with issue strings on invalid input", () => {
    const result = parseCandidate({ ...valid, steps: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });
});
