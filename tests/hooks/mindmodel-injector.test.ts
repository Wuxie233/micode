// tests/hooks/mindmodel-injector.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("mindmodel-injector hook", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mindmodel-injector-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createMockCtx(directory: string) {
    return {
      directory,
      client: {
        session: {},
        tui: {},
      },
    };
  }

  function setupMindmodel(dir: string) {
    const mindmodelDir = join(dir, ".mindmodel");
    mkdirSync(join(mindmodelDir, "components"), { recursive: true });

    writeFileSync(
      join(mindmodelDir, "manifest.yaml"),
      `
name: test-project
version: 1
categories:
  - path: components/button.md
    description: Button component patterns
  - path: components/form.md
    description: Form patterns
`,
    );

    writeFileSync(
      join(mindmodelDir, "components/button.md"),
      "# Button\n\nUse this pattern for buttons.\n\n```tsx\n<Button>Click</Button>\n```",
    );
    writeFileSync(
      join(mindmodelDir, "components/form.md"),
      "# Form\n\nUse this pattern for forms.\n\n```tsx\n<Form onSubmit={...} />\n```",
    );
  }

  it("should not inject if no .mindmodel directory exists", async () => {
    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    const hook = createMindmodelInjectorHook(ctx as any, async () => "[]");

    const output = { system: "existing system prompt" };
    await hook["chat.params"]({ sessionID: "test" }, output);

    expect(output.system).toBe("existing system prompt");
  });

  it("should inject examples when classifier returns categories", async () => {
    setupMindmodel(testDir);

    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    // Mock classifier that returns form category
    const mockClassify = async () => '["components/form.md"]';
    const hook = createMindmodelInjectorHook(ctx as any, mockClassify);

    const output = { system: "existing prompt" };
    await hook["chat.params"](
      {
        sessionID: "test",
        messages: [{ role: "user", content: "Add a contact form" }],
      },
      output,
    );

    expect(output.system).toContain("mindmodel-examples");
    expect(output.system).toContain("Form");
    expect(output.system).toContain("<Form onSubmit");
  });

  it("should not inject if classifier returns empty array", async () => {
    setupMindmodel(testDir);

    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    const mockClassify = async () => "[]";
    const hook = createMindmodelInjectorHook(ctx as any, mockClassify);

    const output = { system: "existing prompt" };
    await hook["chat.params"](
      {
        sessionID: "test",
        messages: [{ role: "user", content: "What time is it?" }],
      },
      output,
    );

    expect(output.system).toBe("existing prompt");
    expect(output.system).not.toContain("mindmodel-examples");
  });

  it("should extract task from multimodal message content", async () => {
    setupMindmodel(testDir);

    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    const mockClassify = async () => '["components/button.md"]';
    const hook = createMindmodelInjectorHook(ctx as any, mockClassify);

    const output = { system: "existing prompt" };
    await hook["chat.params"](
      {
        sessionID: "test",
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image_url: "data:image/png;base64,..." },
              { type: "text", text: "Add a button component" },
            ],
          },
        ],
      },
      output,
    );

    expect(output.system).toContain("mindmodel-examples");
    expect(output.system).toContain("Button");
  });

  it("should cache mindmodel and call loadMindmodel only once", async () => {
    setupMindmodel(testDir);

    const { createMindmodelInjectorHook } = await import("../../src/hooks/mindmodel-injector");

    const ctx = createMockCtx(testDir);
    let classifyCallCount = 0;
    const mockClassify = async () => {
      classifyCallCount++;
      return '["components/button.md"]';
    };
    const hook = createMindmodelInjectorHook(ctx as any, mockClassify);

    // First call
    const output1 = { system: "prompt1" };
    await hook["chat.params"](
      {
        sessionID: "test1",
        messages: [{ role: "user", content: "Add a button" }],
      },
      output1,
    );

    // Second call
    const output2 = { system: "prompt2" };
    await hook["chat.params"](
      {
        sessionID: "test2",
        messages: [{ role: "user", content: "Add another button" }],
      },
      output2,
    );

    // Both should have injected content (proving mindmodel was loaded)
    expect(output1.system).toContain("mindmodel-examples");
    expect(output2.system).toContain("mindmodel-examples");

    // Classifier should have been called twice (once per request)
    expect(classifyCallCount).toBe(2);
  });
});
