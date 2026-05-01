import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import { runPreflight } from "@/utils/runtime-deploy/preflight";

let workspace: string;
let source: string;
let runtime: string;

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), "rd-pre-"));
  source = join(workspace, "src-repo");
  runtime = join(workspace, "rt-repo");
  await $`git init -q ${source}`;
  await $`git -C ${source} commit --allow-empty -m init -q`;
  await $`git init -q ${runtime}`;
  await $`git -C ${runtime} commit --allow-empty -m init -q`;
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("runPreflight", () => {
  it("returns ok when both checkouts exist and are clean", async () => {
    const r = await runPreflight({ source, runtime });
    expect(r.kind).toBe("ok");
  });

  it("fails when source is missing", async () => {
    const r = await runPreflight({ source: join(workspace, "nope"), runtime });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("source-missing");
  });

  it("fails when runtime is missing", async () => {
    const r = await runPreflight({ source, runtime: join(workspace, "nope") });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("runtime-missing");
  });

  it("fails when source has uncommitted changes", async () => {
    writeFileSync(join(source, "dirty.txt"), "x");
    const r = await runPreflight({ source, runtime });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("source-dirty");
  });

  it("fails when runtime has uncommitted changes and force is not set", async () => {
    writeFileSync(join(runtime, "dirty.txt"), "x");
    const r = await runPreflight({ source, runtime });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("runtime-dirty");
  });

  it("allows runtime dirty when force=true", async () => {
    writeFileSync(join(runtime, "dirty.txt"), "x");
    const r = await runPreflight({ source, runtime, force: true });
    expect(r.kind).toBe("ok");
  });

  it("fails when rsync is missing", async () => {
    const r = await runPreflight({
      source,
      runtime,
      which: (tool) => (tool === "rsync" ? null : tool),
    });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("rsync-missing");
  });

  it("fails when bun is missing", async () => {
    const r = await runPreflight({
      source,
      runtime,
      which: (tool) => (tool === "bun" ? null : tool),
    });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("bun-missing");
  });
});
