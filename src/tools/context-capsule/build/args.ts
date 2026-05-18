import { tool } from "@opencode-ai/plugin/tool";

import { DISPATCH_KINDS, GENERATOR_AGENTS } from "@/agents/context-capsule/types";

const sourceFileSchema = tool.schema.object({
  path: tool.schema.string().describe("Source file path to embed in the generated context capsule"),
  content: tool.schema.string().describe("Full source file content to embed in the generated context capsule"),
});

/**
 * Zod schema for the `build_context_capsule` tool.
 *
 * The tool writes a new capsule under `thoughts/shared/context-capsules/` from
 * caller-provided source content and confirmed facts. It intentionally accepts
 * only portable context fields; git/worktree metadata is derived by execute.
 */
export const buildContextCapsuleArgs = {
  topic: tool.schema.string().min(1).describe("Required short topic/title for the generated context capsule"),
  confirmed_facts: tool.schema
    .array(tool.schema.string())
    .optional()
    .describe("Confirmed facts to include in the capsule body. Optional; defaults to an empty list."),
  source_files: tool.schema
    .array(sourceFileSchema)
    .optional()
    .describe("Source files to embed in the capsule body. Optional; defaults to an empty list."),
  lifecycle_issue: tool.schema
    .number()
    .int()
    .nullable()
    .optional()
    .describe("Lifecycle issue number for capsule frontmatter. Omit or pass null when no lifecycle is active."),
  parent_capsule_sha: tool.schema
    .string()
    .nullable()
    .optional()
    .describe("SHA of the parent capsule this one supersedes or extends. Optional."),
  dispatch_kind: tool.schema.enum(DISPATCH_KINDS).optional().describe("Dispatch path that requested the capsule."),
  generated_by: tool.schema.enum(GENERATOR_AGENTS).optional().describe("Coordinator agent that requested the capsule."),
} as const;

export interface BuildContextCapsuleArgs {
  readonly topic: string;
  readonly confirmed_facts?: readonly string[];
  readonly source_files?: readonly {
    readonly path: string;
    readonly content: string;
  }[];
  readonly lifecycle_issue?: number | null;
  readonly parent_capsule_sha?: string | null;
  readonly dispatch_kind?: (typeof DISPATCH_KINDS)[number];
  readonly generated_by?: (typeof GENERATOR_AGENTS)[number];
}
