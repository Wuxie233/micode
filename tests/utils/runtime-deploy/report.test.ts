import { describe, expect, it } from "bun:test";

import { formatReport } from "@/utils/runtime-deploy/report";
import type { DeployReport } from "@/utils/runtime-deploy/types";

const RESTART_LINE = "Runtime ready. Restart of OpenCode requires explicit user approval.";

describe("formatReport", () => {
  it("renders a successful apply run", () => {
    const report: DeployReport = {
      mode: "apply",
      ready: true,
      preflight: { kind: "ok", sourceCommit: "abc1234", runtimeCommit: "def5678" },
      sync: { kind: "ok", filesChanged: 12, bytesTransferred: 4096 },
      build: { kind: "ok", bundleBytes: 234567, installRan: true },
    };
    const out = formatReport(report);
    expect(out).toContain("MODE: apply");
    expect(out).toContain("PREFLIGHT: ok");
    expect(out).toContain("source=abc1234");
    expect(out).toContain("runtime=def5678");
    expect(out).toContain("SYNC: ok files=12");
    expect(out).toContain("BUILD: ok bundle=234567 bytes installRan=true");
    expect(out).toContain(RESTART_LINE);
  });

  it("never claims ready=true on failure", () => {
    const report: DeployReport = {
      mode: "apply",
      ready: false,
      preflight: { kind: "failed", reason: "source-dirty", detail: "dirty" },
      sync: null,
      build: null,
    };
    const out = formatReport(report);
    expect(out).toContain("PREFLIGHT: failed");
    expect(out).toContain("reason=source-dirty");
    expect(out).not.toContain("Runtime ready.");
    expect(out).toContain("NOT READY");
  });

  it("formats a dry-run report without claiming readiness", () => {
    const report: DeployReport = {
      mode: "dry-run",
      ready: false,
      preflight: { kind: "ok", sourceCommit: "a", runtimeCommit: "b" },
      sync: { kind: "ok", filesChanged: 3, bytesTransferred: 100 },
      build: null,
    };
    const out = formatReport(report);
    expect(out).toContain("MODE: dry-run");
    expect(out).toContain("DRY-RUN");
    expect(out).not.toContain("Runtime ready.");
  });
});
