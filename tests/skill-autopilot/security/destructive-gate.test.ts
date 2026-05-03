import { describe, expect, it } from "bun:test";

import { destructiveGate } from "@/skill-autopilot/security/destructive-gate";

function inp(steps: readonly string[]) {
  return { name: "n", description: "d", trigger: "t", steps, body: "x", frontmatter: { name: "n" } };
}

describe("destructiveGate", () => {
  it.each([
    "rm -rf /tmp/foo",
    "rm -r ~/data",
    "git push --force",
    "DROP TABLE users",
    "mkfs.ext4 /dev/sda1",
    "shred /etc/passwd",
    "echo bad > /dev/sda",
  ])("rejects %s", (cmd) => {
    expect(destructiveGate(inp([cmd])).ok).toBe(false);
  });

  it("allows --force-with-lease", () => {
    expect(destructiveGate(inp(["git push --force-with-lease origin feature"])).ok).toBe(true);
  });

  it("allows neutral steps", () => {
    expect(destructiveGate(inp(["bun run check"])).ok).toBe(true);
  });
});
