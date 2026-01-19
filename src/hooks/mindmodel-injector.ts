// src/hooks/mindmodel-injector.ts
import type { PluginInput } from "@opencode-ai/plugin";

import {
  buildClassifierPrompt,
  formatExamplesForInjection,
  type LoadedMindmodel,
  loadExamples,
  loadMindmodel,
  parseClassifierResponse,
} from "../mindmodel";
import { log } from "../utils/logger";

type ClassifyFn = (prompt: string) => Promise<string>;

interface ChatMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
}

function extractTaskFromMessages(messages: ChatMessage[]): string {
  // Get the last user message
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) return "";

  if (typeof lastUserMessage.content === "string") {
    return lastUserMessage.content;
  }

  // Handle array content (multimodal)
  return lastUserMessage.content
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join(" ");
}

export function createMindmodelInjectorHook(ctx: PluginInput, classifyFn: ClassifyFn) {
  let cachedMindmodel: LoadedMindmodel | null | undefined;

  async function getMindmodel(): Promise<LoadedMindmodel | null> {
    if (cachedMindmodel === undefined) {
      cachedMindmodel = await loadMindmodel(ctx.directory);
    }
    return cachedMindmodel;
  }

  return {
    "chat.params": async (
      input: { sessionID: string; messages?: ChatMessage[] },
      output: { options?: Record<string, unknown>; system?: string },
    ) => {
      try {
        const mindmodel = await getMindmodel();
        if (!mindmodel) {
          log.info("mindmodel", "No .mindmodel/ found, skipping injection");
          return;
        }

        const messages = input.messages ?? [];
        const task = extractTaskFromMessages(messages);
        if (!task) {
          log.info("mindmodel", "No task extracted from messages, skipping");
          return;
        }

        log.info("mindmodel", `Classifying task: "${task.slice(0, 100)}..."`);

        // Classify the task
        const classifierPrompt = buildClassifierPrompt(task, mindmodel.manifest);
        const classifierResponse = await classifyFn(classifierPrompt);
        const categories = parseClassifierResponse(classifierResponse, mindmodel.manifest);

        if (categories.length === 0) {
          log.info("mindmodel", "No matching categories found");
          return;
        }

        log.info("mindmodel", `Matched categories: ${categories.join(", ")}`);

        // Load and format examples
        const examples = await loadExamples(mindmodel, categories);
        if (examples.length === 0) {
          log.info("mindmodel", "No examples found for categories");
          return;
        }

        const formatted = formatExamplesForInjection(examples);

        // Inject into system prompt
        if (output.system) {
          output.system = formatted + "\n\n" + output.system;
        } else {
          output.system = formatted;
        }

        log.info("mindmodel", `Injected ${examples.length} examples into system prompt`);
      } catch (error) {
        // Graceful degradation - log warning but don't crash the hook chain
        log.warn("mindmodel", `Failed to inject examples: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    },
  };
}
