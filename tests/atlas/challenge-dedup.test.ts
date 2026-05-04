import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addDismissedChallenge, isDismissed, loadDismissedChallenges } from "@/atlas/challenge-dedup";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-dedup-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("challenge dedup", () => {
  it("returns empty when dismissed file missing", () => {
    expect(loadDismissedChallenges(projectRoot)).toEqual([]);
  });

  it("loads parses and queries dismissed entries", () => {
    const path = join(projectRoot, "atlas", "_meta", "challenges", "_dismissed.json");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify([{ target: "a.md", claimHash: "abc", dismissedAt: "2026-01-01" }]), "utf8");
    expect(isDismissed(projectRoot, "a.md", "abc")).toBe(true);
    expect(isDismissed(projectRoot, "a.md", "other")).toBe(false);
  });

  it("ignores malformed dismissed entries", () => {
    const path = join(projectRoot, "atlas", "_meta", "challenges", "_dismissed.json");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify([
        { target: "a.md", claimHash: "abc", dismissedAt: "2026-01-01" },
        { target: "b.md", claimHash: 1, dismissedAt: "2026-01-01" },
        null,
      ]),
      "utf8",
    );
    expect(loadDismissedChallenges(projectRoot)).toEqual([
      { target: "a.md", claimHash: "abc", dismissedAt: "2026-01-01" },
    ]);
  });

  it("addDismissedChallenge appends to file", () => {
    addDismissedChallenge(projectRoot, { target: "x.md", claimHash: "h1", dismissedAt: "2026-05-04" });
    addDismissedChallenge(projectRoot, { target: "y.md", claimHash: "h2", dismissedAt: "2026-05-04" });
    const all = loadDismissedChallenges(projectRoot);
    expect(all).toHaveLength(2);
  });
});
