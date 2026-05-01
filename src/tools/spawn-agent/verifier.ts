import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { parseVerifierResponse, VERIFIER_CONFIDENCE, type VerifierResult } from "./verifier-types";

export interface VerifyMarkerInput {
  readonly assistantText: string;
  readonly marker: string;
}

export interface VerifierDeps {
  readonly runClassification: (prompt: string) => Promise<string>;
  readonly timeoutMs: number;
  readonly maxOutputChars: number;
}

const LOG_MODULE = "spawn-agent.verifier";
const PROMPT_HEADER = `You are a strict classifier. Decide whether the marker below is the subagent's FINAL status declaration or a NARRATIVE mention.
Reply with JSON only: {"decision":"final"|"narrative","confidence":"high"|"low","reason":"short text"}.`;

function buildPrompt(input: VerifyMarkerInput, maxOutputChars: number): string {
  const trimmed =
    input.assistantText.length <= maxOutputChars
      ? input.assistantText
      : `${input.assistantText.slice(0, maxOutputChars)}\n[truncated]`;
  return [PROMPT_HEADER, "", `Marker: ${input.marker}`, "", "Subagent output:", "```", trimmed, "```"].join("\n");
}

function withTimeout(promise: Promise<string>, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<string>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`verifier timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

export async function verifyMarker(input: VerifyMarkerInput, deps: VerifierDeps): Promise<VerifierResult | null> {
  const prompt = buildPrompt(input, deps.maxOutputChars);
  let raw: string;
  try {
    raw = await withTimeout(deps.runClassification(prompt), deps.timeoutMs);
  } catch (error) {
    log.debug(LOG_MODULE, `verifier failed: ${extractErrorMessage(error)}`);
    return null;
  }
  const parsed = parseVerifierResponse(raw);
  if (parsed === null) return null;
  if (parsed.confidence === VERIFIER_CONFIDENCE.LOW) return null;
  return parsed;
}
