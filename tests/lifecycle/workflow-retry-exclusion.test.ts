import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";

const SCAN_DIRS = ["src/lifecycle", "src/tools/lifecycle"] as const;

const FORBIDDEN_WORKFLOW_RETRY_PATTERNS = [
  /workflow-retry/u,
  /WORKFLOW_CONTINUATION_RETRY_POLICY/u,
  /WorkflowContinuationRetryPolicy/u,
  /isRecoverableUpstreamError/u,
  /createAttemptRegistry/u,
  /AttemptRegistry/u,
  /config\.workflowRetry/u,
] as const;

const walk = (dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
};

describe("lifecycle excludes workflow continuation retry policy", () => {
  for (const dir of SCAN_DIRS) {
    it(`${dir} does not reference workflow-retry policy, predicate, or registry`, () => {
      const files: string[] = [];
      walk(dir, files);
      expect(files.length).toBeGreaterThan(0);

      for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN_WORKFLOW_RETRY_PATTERNS) {
          expect({ file, matched: pattern.toString(), hit: pattern.test(src) }).toEqual({
            file,
            matched: pattern.toString(),
            hit: false,
          });
        }
      }
    });
  }

  it("lifecycle config keeps its own retry and timeout controls", () => {
    expect(config.lifecycle.pushRetryBackoffMs).toBe(5000);
    expect(config.lifecycle.prCheckTimeoutMs).toBe(600_000);
    expect(config.lifecycle.failedSessionTtlHours).toBe(24);
    expect(config.lifecycle.leaseTtlMs).toBe(600_000);

    const configSrc = readFileSync("src/utils/config.ts", "utf8");
    expect(configSrc).toContain("pushRetryBackoffMs");
    expect(configSrc).toContain("prCheckTimeoutMs");
    expect(configSrc).toContain("failedSessionTtlHours");
    expect(configSrc).not.toContain("workflowRetry");
  });
});
