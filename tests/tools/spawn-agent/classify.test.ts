import { describe, expect, it } from "bun:test";

import {
  type ClassifyInput,
  classifySpawnError,
  INTERNAL_CLASSES,
  type InternalClass,
} from "../../../src/tools/spawn-agent/classify";
import {
  BLOCKED_MARKERS,
  TASK_ERROR_MARKERS,
  TRANSIENT_HTTP_STATUSES,
} from "../../../src/tools/spawn-agent/classify-tokens";

const NETWORK_MESSAGE = "fetch failed while contacting provider";
const HARD_MESSAGE = "session create failed before the agent started";
const SUCCESS_OUTPUT = "All checks passed and the task is done.";
const EMPTY_RESPONSE_REASON = "empty response";

const classify = (input: ClassifyInput): { readonly class: InternalClass; readonly reason: string } =>
  classifySpawnError(input);

describe("spawn-agent failure classifier", () => {
  it("classifies transient thrown network failures before assistant markers", () => {
    const outcome = classify({
      thrown: new Error(NETWORK_MESSAGE),
      assistantText: `${BLOCKED_MARKERS[0]} credentials missing`,
    });

    expect(outcome).toEqual({ class: INTERNAL_CLASSES.TRANSIENT, reason: NETWORK_MESSAGE });
  });

  it("classifies transient HTTP statuses before assistant markers", () => {
    const status = TRANSIENT_HTTP_STATUSES[0];
    const outcome = classify({
      httpStatus: status,
      assistantText: `${TASK_ERROR_MARKERS[0]} from previous output`,
    });

    expect(outcome).toEqual({ class: INTERNAL_CLASSES.TRANSIENT, reason: `transient HTTP status ${status}` });
  });

  it("classifies blocked assistant output before task errors", () => {
    const outcome = classify({
      assistantText: `${BLOCKED_MARKERS[0]} missing approval and ${TASK_ERROR_MARKERS[0]}`,
    });

    expect(outcome).toEqual({ class: INTERNAL_CLASSES.BLOCKED, reason: `assistant marker ${BLOCKED_MARKERS[0]}` });
  });

  it("classifies task-error assistant output", () => {
    const outcome = classify({ assistantText: `${TASK_ERROR_MARKERS[0]} after bun test` });

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.TASK_ERROR,
      reason: `assistant marker ${TASK_ERROR_MARKERS[0]}`,
    });
  });

  it("classifies non-transient unknown thrown failures without assistant text as hard failures", () => {
    const outcome = classify({ thrown: HARD_MESSAGE });

    expect(outcome).toEqual({ class: INTERNAL_CLASSES.HARD_FAILURE, reason: HARD_MESSAGE });
  });

  it("classifies non-empty assistant output as success", () => {
    const outcome = classify({ assistantText: SUCCESS_OUTPUT });

    expect(outcome).toEqual({ class: INTERNAL_CLASSES.SUCCESS, reason: "assistant output present" });
  });

  it("classifies missing output as an empty-response hard failure", () => {
    const outcome = classify({ thrown: null, assistantText: "" });

    expect(outcome).toEqual({ class: INTERNAL_CLASSES.HARD_FAILURE, reason: EMPTY_RESPONSE_REASON });
  });
});
