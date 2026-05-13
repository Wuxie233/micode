# Tool Definition & Formatting

## Rules

- **Tool factory signature**: `createXTool(ctx: PluginInput): ToolDefinition` or `createXTool(ctx): { tool_name: ToolDefinition }` for multi-tool factories.
- **Always use `tool()` from `@opencode-ai/plugin/tool`** to construct a `ToolDefinition`. Never build the shape manually.
- **Args declared via `tool.schema.*`**: `tool.schema.string()`, `tool.schema.number()`, `tool.schema.array(...)`, `.optional()`, `.describe(...)`.
- **`execute` must return a `string`** (formatted Markdown). Never return a structured object — the plugin runtime expects a string result.
- **Error paths also return formatted strings** — use `"## ToolName Failed\n\nReason"` prefix so agents parse it consistently.
- **Parallel I/O with `Promise.all`**: when a tool reads multiple files or makes multiple queries, fan out and await together.
- **Result format**: use `# Heading`, `## Sub`, fenced code blocks, and structured lists. Agents parse these strings as Markdown.
- **No side effects** in tool execute beyond reading and formatting — tools must not write files, spawn processes, or modify state (except specialized tools like `pty_spawn`).

## Examples

### Standard tool factory with parallel reads

```typescript
// src/tools/batch-read.ts
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import { extractErrorMessage } from "@/utils/errors";

export function createBatchReadTool(ctx: PluginInput): ToolDefinition {
  return tool({
    description: `Read multiple files in parallel. Much faster than reading files one at a time.`,
    args: {
      paths: tool.schema.array(tool.schema.string()).describe("Array of file paths to read"),
      maxLines: tool.schema.number().optional().describe("Limit each file to first N lines"),
    },
    execute: async (args) => {
      const { paths, maxLines } = args;
      if (!paths || paths.length === 0) return "## batch_read Failed\n\nNo paths specified";
      const results = await Promise.all(paths.map((p) => readSingleFile(p, ctx.directory, maxLines)));
      return formatResults(results, paths.length);
    },
  });
}
```

### Multi-tool factory (named map)

```typescript
// src/tools/mindmodel-lookup.ts
export function createMindmodelLookupTool(ctx: PluginInput): { mindmodel_lookup: ToolDefinition } {
  const mindmodel_lookup = tool({
    description: `Look up coding patterns from .mindmodel/ directory.`,
    args: { query: tool.schema.string().describe("What you're trying to implement") },
    execute: async ({ query }) => {
      try {
        const model = await getMindmodel(ctx.directory);
        if (!model) return "No .mindmodel/ directory found. Proceed without specific patterns.";
        const categories = matchCategories(query, model.manifest);
        if (categories.length === 0) return "No specific patterns found. Use general best practices.";
        const examples = await loadExamples(model, categories);
        return formatExamplesForInjection(examples);
      } catch (error) {
        log.error("mindmodel", "lookup failed", error);
        return `## mindmodel_lookup Failed\n\n${extractErrorMessage(error)}`;
      }
    },
  });
  return { mindmodel_lookup };
}
```

### Formatted result structure

```typescript
// src/tools/batch-read.ts
function formatResults(results: FileResult[], totalFiles: number): string {
  const output: string[] = [`# Batch Read (${totalFiles} files)\n`];
  for (const result of results) {
    if (result.error) {
      output.push(`## ${result.path}\n\n**Error**: ${result.error}\n`);
    } else {
      output.push(`## ${result.path}\n\n\`\`\`\n${result.content}\n\`\`\`\n`);
    }
  }
  return output.join("\n");
}
```

## Anti-patterns

### Returning a structured object from execute

```typescript
// BAD: plugin runtime expects a string
execute: async (args) => {
  return { files: results, count: results.length }; // object — wrong type
}

// GOOD: format as Markdown string
execute: async (args) => {
  return formatResults(results, results.length); // string
}
```

### Throwing instead of returning error string

```typescript
// BAD: unhandled throw reaches OpenCode runtime
execute: async (args) => {
  if (!args.query) throw new Error("query required");
}

// GOOD: return error message string
execute: async (args) => {
  if (!args.query) return "## mindmodel_lookup Failed\n\nquery is required";
}
```

### Writing files or mutating state inside a read tool

```typescript
// BAD: tools must not have side effects
execute: async (args) => {
  const content = await readFile(args.path);
  await writeFile("/tmp/cache", content); // side effect in a read tool
  return content;
}
```
