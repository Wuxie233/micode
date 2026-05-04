import { describe, expect, it } from "bun:test";

import { COLD_INIT_RUN_ID_PREFIX } from "@/atlas/cold-init/config";
import { createColdInitRunId } from "@/atlas/cold-init/run-id";

describe("createColdInitRunId", () => {
  it("starts with the cold-init prefix", () => {
    expect(createColdInitRunId().startsWith(`${COLD_INIT_RUN_ID_PREFIX}-`)).toBe(true);
  });

  it("produces unique ids across calls", () => {
    const a = createColdInitRunId();
    const b = createColdInitRunId();
    expect(a).not.toBe(b);
  });
});
