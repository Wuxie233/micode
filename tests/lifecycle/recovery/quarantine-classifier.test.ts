import { describe, expect, it } from "bun:test";

import { classifyQuarantine } from "@/lifecycle/recovery/quarantine-classifier";

describe("classifyQuarantine", () => {
  it("quarantines untracked files matching known lifecycle artifact pointers", () => {
    const r = classifyQuarantine({
      untrackedPath: "thoughts/shared/designs/2026-05-12-foo-design.md",
      artifactPointers: ["thoughts/shared/designs/2026-05-12-foo-design.md"],
    });
    expect(r.kind).toBe("quarantine");
    expect(r.reason).toContain("matches_artifact_pointer");
  });

  it("quarantines files under thoughts/shared/designs/ even without explicit pointer", () => {
    const r = classifyQuarantine({
      untrackedPath: "thoughts/shared/designs/2026-05-12-anything.md",
      artifactPointers: [],
    });
    expect(r.kind).toBe("quarantine");
    expect(r.reason).toContain("lifecycle_owned_prefix");
  });

  it("quarantines files under thoughts/shared/plans/ and thoughts/shared/atlas-deltas/", () => {
    expect(classifyQuarantine({ untrackedPath: "thoughts/shared/plans/x.md", artifactPointers: [] }).kind).toBe(
      "quarantine",
    );
    expect(classifyQuarantine({ untrackedPath: "thoughts/shared/atlas-deltas/x.md", artifactPointers: [] }).kind).toBe(
      "quarantine",
    );
  });

  it("blocks unknown untracked files (could be user work)", () => {
    const r = classifyQuarantine({ untrackedPath: "src/some-new-file.ts", artifactPointers: [] });
    expect(r.kind).toBe("block");
    expect(r.reason).toContain("unknown_untracked");
  });

  it("blocks .env, .secret*, credentials*, regardless of prefix", () => {
    expect(classifyQuarantine({ untrackedPath: "thoughts/shared/designs/.env", artifactPointers: [] }).kind).toBe(
      "block",
    );
    expect(
      classifyQuarantine({ untrackedPath: "thoughts/shared/plans/credentials.json", artifactPointers: [] }).kind,
    ).toBe("block");
  });

  it("blocks paths attempting to escape via ../", () => {
    const r = classifyQuarantine({ untrackedPath: "../outside/file.md", artifactPointers: [] });
    expect(r.kind).toBe("block");
    expect(r.reason).toContain("path_escape");
  });
});
