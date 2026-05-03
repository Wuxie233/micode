import { describe, expect, it } from "bun:test";

import type { JournalEvent } from "@/lifecycle/journal/types";
import { extractCandidatesFromSources, type MinerInput } from "@/skill-evolution/miner";

const baseEvent = (overrides: Partial<JournalEvent> = {}): JournalEvent => ({
  kind: "batch_completed",
  issueNumber: 24,
  seq: 1,
  at: 1_700_000_000_000,
  batchId: "b1",
  taskId: null,
  attempt: 1,
  summary: "batch 1 summary",
  commitMarker: null,
  reviewOutcome: null,
  ...overrides,
});

describe("extractCandidatesFromSources", () => {
  const projectId = "p1";
  const now = 1_700_000_000_000;
  const expiryMs = 30 * 24 * 3600 * 1000;

  it("emits a candidate from approved batch_completed + review_completed sequence", () => {
    const input: MinerInput = {
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: "## Request\nImprove project memory promotion quality.\n",
      journalEvents: [
        baseEvent({ seq: 1, summary: "wire types", batchId: "b1" }),
        baseEvent({ seq: 2, summary: "wire parser", batchId: "b2" }),
        baseEvent({
          kind: "review_completed",
          seq: 3,
          summary: "review approved",
          batchId: "b2",
          reviewOutcome: "approved",
        }),
      ],
      ledgers: [],
    };

    const out = extractCandidatesFromSources(input);
    expect(out.candidates.length).toBe(1);
    expect(out.candidates[0].steps).toEqual(["wire types", "wire parser"]);
    expect(out.candidates[0].trigger).toContain("Improve project memory promotion quality");
    expect(out.candidates[0].sensitivity).toBe("internal");
    expect(out.candidates[0].status).toBe("pending");
    expect(out.candidates[0].sources.length).toBeGreaterThan(0);
    expect(out.candidates[0].expiresAt).toBe(now + expiryMs);
  });

  it("skips when no review_completed approved event is present", () => {
    const out = extractCandidatesFromSources({
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: null,
      journalEvents: [baseEvent({ seq: 1, summary: "lonely batch" })],
      ledgers: [],
    });
    expect(out.candidates).toEqual([]);
  });

  it("skips when reviewOutcome is changes_requested", () => {
    const out = extractCandidatesFromSources({
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: "## Request\nx\n",
      journalEvents: [
        baseEvent({ seq: 1, summary: "step a" }),
        baseEvent({ kind: "review_completed", seq: 2, summary: "x", reviewOutcome: "changes_requested" }),
      ],
      ledgers: [],
    });
    expect(out.candidates).toEqual([]);
  });

  it("emits a candidate per ## Procedure bullet found in ledger markdown", () => {
    const out = extractCandidatesFromSources({
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: null,
      lifecycleRecord: null,
      journalEvents: [],
      ledgers: [
        {
          path: "thoughts/ledgers/CONTINUITY_2026-05-03.md",
          text: "## Procedure\n- Trigger A; Step1; Step2; Step3\n- Trigger B; Step1\n",
        },
      ],
    });
    expect(out.candidates.length).toBe(2);
    expect(out.candidates.every((c) => c.sources[0].kind === "ledger")).toBe(true);
  });

  it("rejects candidates whose sanitization fails (e.g., contains a secret)", () => {
    const out = extractCandidatesFromSources({
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: "## Request\nrun with AKIAABCDEFGHIJKLMNOP\n",
      journalEvents: [
        baseEvent({ seq: 1, summary: "batch" }),
        baseEvent({ kind: "review_completed", seq: 2, summary: "approved", reviewOutcome: "approved" }),
      ],
      ledgers: [],
    });
    expect(out.candidates.length).toBe(0);
    expect(out.rejected.length).toBe(1);
    expect(out.rejected[0].reason).toContain("secret");
  });

  it("caps steps at 16 even when many batch_completed events are present", () => {
    const events: JournalEvent[] = [];
    for (let i = 0; i < 20; i += 1) {
      events.push(baseEvent({ seq: i + 1, summary: `batch ${i}` }));
    }
    events.push(baseEvent({ kind: "review_completed", seq: 21, summary: "approved", reviewOutcome: "approved" }));
    const out = extractCandidatesFromSources({
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: "## Request\ntopic\n",
      journalEvents: events,
      ledgers: [],
    });
    expect(out.candidates.length).toBe(1);
    expect(out.candidates[0].steps.length).toBe(16);
  });

  it("assigns deterministic ids based on (projectId, dedupeKey) so re-runs deduplicate", () => {
    const input: MinerInput = {
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: "## Request\nsame topic\n",
      journalEvents: [
        baseEvent({ seq: 1, summary: "step one" }),
        baseEvent({ kind: "review_completed", seq: 2, summary: "ok", reviewOutcome: "approved" }),
      ],
      ledgers: [],
    };

    const a = extractCandidatesFromSources(input);
    const b = extractCandidatesFromSources(input);
    expect(a.candidates[0].id).toBe(b.candidates[0].id);
  });
});
