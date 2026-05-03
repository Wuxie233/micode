import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import { candidateFilePath, candidateRootDir } from "@/skill-evolution/paths";

describe("skill-evolution paths", () => {
  it("candidateRootDir scopes by projectId under the user config tree", () => {
    const result = candidateRootDir("proj_abc123");
    expect(result).toBe(join(homedir(), ".config", "opencode", "project-skill-candidates", "proj_abc123"));
  });

  it("candidateFilePath places candidate JSON files in the project root with .json suffix", () => {
    const result = candidateFilePath("proj_abc123", "cand_def456");
    expect(result).toBe(
      join(homedir(), ".config", "opencode", "project-skill-candidates", "proj_abc123", "cand_def456.json"),
    );
  });

  it("candidateRootDir uses a provided candidate store root", () => {
    const result = candidateRootDir("proj_abc123", "/tmp/skill-candidates");
    expect(result).toBe(join("/tmp/skill-candidates", "proj_abc123"));
  });

  it("candidateFilePath uses a provided candidate store root", () => {
    const result = candidateFilePath("proj_abc123", "cand_def456", "/tmp/skill-candidates");
    expect(result).toBe(join("/tmp/skill-candidates", "proj_abc123", "cand_def456.json"));
  });

  it("rejects projectId containing path separators", () => {
    expect(() => candidateRootDir("proj/escape")).toThrow();
    expect(() => candidateRootDir("../escape")).toThrow();
  });

  it("rejects candidateId containing path separators", () => {
    expect(() => candidateFilePath("proj", "cand/escape")).toThrow();
    expect(() => candidateFilePath("proj", "../cand")).toThrow();
  });

  it("rejects empty projectId or candidateId", () => {
    expect(() => candidateRootDir("")).toThrow();
    expect(() => candidateFilePath("proj", "")).toThrow();
  });
});
