import { describe, expect, it } from "bun:test";

import { extractSpawnReceipt, renderSpawnReceiptBlock, upsertSpawnReceiptMarker } from "@/atlas/spawn-receipt-marker";
import { ATLAS_SPAWN_OUTCOMES, type AtlasSpawnReceipt } from "@/atlas/types";

const SAMPLE: AtlasSpawnReceipt = {
  runId: "agent2-26-100",
  sessionId: "sess-x",
  spawnAt: "2026-05-04T00:00:00.000Z",
  expectedCompletionWindowSec: 1800,
  doneAt: null,
  summary: null,
  outcome: ATLAS_SPAWN_OUTCOMES.PENDING,
};

describe("spawn receipt marker", () => {
  it("renders block with begin/end markers", () => {
    expect(renderSpawnReceiptBlock(SAMPLE)).toContain("<!-- micode:atlas:spawn:begin -->");
  });

  it("round trips upsert + extract", () => {
    const body = upsertSpawnReceiptMarker("existing", SAMPLE);
    expect(extractSpawnReceipt(body)).toEqual(SAMPLE);
  });

  it("returns null when missing", () => {
    expect(extractSpawnReceipt("nothing")).toBe(null);
  });

  it("supports updating doneAt and outcome", () => {
    const initial = upsertSpawnReceiptMarker("", SAMPLE);
    const updated = upsertSpawnReceiptMarker(initial, {
      ...SAMPLE,
      doneAt: "2026-05-04T00:30:00.000Z",
      summary: "ok",
      outcome: ATLAS_SPAWN_OUTCOMES.SUCCEEDED,
    });
    const extracted = extractSpawnReceipt(updated);
    expect(extracted?.outcome).toBe("succeeded");
    expect(extracted?.doneAt).toBe("2026-05-04T00:30:00.000Z");
  });
});
