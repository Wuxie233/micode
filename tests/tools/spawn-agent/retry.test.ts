import { describe, expect, it } from "bun:test";

import { INTERNAL_CLASSES, type InternalClass } from "../../../src/tools/spawn-agent/classify";
import { retryOnTransient } from "../../../src/tools/spawn-agent/retry";

interface AttemptOutcome<T> {
  readonly class: InternalClass;
  readonly value: T;
}

const FIRST_DELAY_MS = 10;
const SECOND_DELAY_MS = 20;
const CLAMPED_DELAY_MS = 30;
const SHORT_BUDGET_MS = 10;
const FINITE_BUDGET_MS = 15;
const EXHAUSTED_TIME_MS = 20;
const TWO_RETRIES = 2;
const THREE_RETRIES = 3;
const TRANSIENT_VALUE = "transient";
const FIRST_TRANSIENT_VALUE = "first transient";
const SECOND_TRANSIENT_VALUE = "second transient";
const FINAL_TRANSIENT_VALUE = "final transient";
const SUCCESS_VALUE = "success";

function createAttempt<T>(outcomes: readonly AttemptOutcome<T>[]): () => Promise<AttemptOutcome<T>> {
  let index = 0;

  return async (): Promise<AttemptOutcome<T>> => {
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    return outcome;
  };
}

function createSleep(delays: number[]): (ms: number) => Promise<void> {
  return async (ms: number): Promise<void> => {
    delays.push(ms);
  };
}

describe("spawn-agent transient retry", () => {
  it("retries transient outcomes until success and reports used retries", async () => {
    const delays: number[] = [];
    const attempt = createAttempt([
      { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE },
      { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE },
      { class: INTERNAL_CLASSES.SUCCESS, value: SUCCESS_VALUE },
    ]);

    const outcome = await retryOnTransient(attempt, {
      retries: TWO_RETRIES,
      backoffMs: [FIRST_DELAY_MS, SECOND_DELAY_MS],
      sleep: createSleep(delays),
    });

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.SUCCESS,
      value: SUCCESS_VALUE,
      retries: TWO_RETRIES,
      budgetExhausted: false,
    });
    expect(delays).toEqual([FIRST_DELAY_MS, SECOND_DELAY_MS]);
  });

  it("returns the last transient outcome when retries are exhausted", async () => {
    const delays: number[] = [];
    const attempt = createAttempt([
      { class: INTERNAL_CLASSES.TRANSIENT, value: FIRST_TRANSIENT_VALUE },
      { class: INTERNAL_CLASSES.TRANSIENT, value: SECOND_TRANSIENT_VALUE },
      { class: INTERNAL_CLASSES.TRANSIENT, value: FINAL_TRANSIENT_VALUE },
    ]);

    const outcome = await retryOnTransient(attempt, {
      retries: TWO_RETRIES,
      backoffMs: [FIRST_DELAY_MS, SECOND_DELAY_MS],
      sleep: createSleep(delays),
    });

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.TRANSIENT,
      value: FINAL_TRANSIENT_VALUE,
      retries: TWO_RETRIES,
      budgetExhausted: false,
    });
    expect(delays).toEqual([FIRST_DELAY_MS, SECOND_DELAY_MS]);
  });

  it("clamps backoff delays to the last configured entry", async () => {
    const delays: number[] = [];
    const attempt = createAttempt([
      { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE },
      { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE },
      { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE },
      { class: INTERNAL_CLASSES.SUCCESS, value: SUCCESS_VALUE },
    ]);

    const outcome = await retryOnTransient(attempt, {
      retries: THREE_RETRIES,
      backoffMs: [CLAMPED_DELAY_MS],
      sleep: createSleep(delays),
    });

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.SUCCESS,
      value: SUCCESS_VALUE,
      retries: THREE_RETRIES,
      budgetExhausted: false,
    });
    expect(delays).toEqual([CLAMPED_DELAY_MS, CLAMPED_DELAY_MS, CLAMPED_DELAY_MS]);
  });

  it("treats invalid and infinite retry budgets as no budget", async () => {
    const delays: number[] = [];
    const attempt = createAttempt([
      { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE },
      { class: INTERNAL_CLASSES.SUCCESS, value: SUCCESS_VALUE },
    ]);

    const outcome = await retryOnTransient(attempt, {
      retries: TWO_RETRIES,
      backoffMs: [FIRST_DELAY_MS],
      retryBudgetMs: Number.NaN,
      now: () => EXHAUSTED_TIME_MS,
      sleep: createSleep(delays),
    });

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.SUCCESS,
      value: SUCCESS_VALUE,
      retries: 1,
      budgetExhausted: false,
    });
    expect(delays).toEqual([FIRST_DELAY_MS]);
  });

  it("clamps negative retry budgets to zero before sleeping", async () => {
    const delays: number[] = [];
    let attempts = 0;

    const outcome = await retryOnTransient(
      async () => {
        attempts += 1;
        return { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE };
      },
      {
        retries: TWO_RETRIES,
        backoffMs: [FIRST_DELAY_MS],
        retryBudgetMs: -1,
        now: () => 0,
        sleep: createSleep(delays),
      },
    );

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.TRANSIENT,
      value: TRANSIENT_VALUE,
      retries: 0,
      budgetExhausted: true,
    });
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it("does not cancel an in-flight attempt that exceeds the retry budget", async () => {
    const delays: number[] = [];
    let currentTime = 0;
    let attempts = 0;

    const outcome = await retryOnTransient(
      async () => {
        attempts += 1;
        currentTime = EXHAUSTED_TIME_MS;
        return { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE };
      },
      {
        retries: TWO_RETRIES,
        backoffMs: [FIRST_DELAY_MS],
        retryBudgetMs: SHORT_BUDGET_MS,
        now: () => currentTime,
        sleep: createSleep(delays),
      },
    );

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.TRANSIENT,
      value: TRANSIENT_VALUE,
      retries: 0,
      budgetExhausted: true,
    });
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it("checks the retry budget before starting the next attempt after sleep", async () => {
    const delays: number[] = [];
    let currentTime = 0;
    let attempts = 0;

    const outcome = await retryOnTransient(
      async () => {
        attempts += 1;
        return { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE };
      },
      {
        retries: TWO_RETRIES,
        backoffMs: [FIRST_DELAY_MS],
        retryBudgetMs: SHORT_BUDGET_MS,
        now: () => currentTime,
        sleep: async (ms) => {
          delays.push(ms);
          currentTime = EXHAUSTED_TIME_MS;
        },
      },
    );

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.TRANSIENT,
      value: TRANSIENT_VALUE,
      retries: 0,
      budgetExhausted: true,
    });
    expect(attempts).toBe(1);
    expect(delays).toEqual([FIRST_DELAY_MS]);
  });

  it("does not sleep when the next delay would exceed a finite retry budget", async () => {
    const delays: number[] = [];
    let attempts = 0;

    const outcome = await retryOnTransient(
      async () => {
        attempts += 1;
        return { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE };
      },
      {
        retries: TWO_RETRIES,
        backoffMs: [SECOND_DELAY_MS],
        retryBudgetMs: SHORT_BUDGET_MS,
        now: () => 0,
        sleep: createSleep(delays),
      },
    );

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.TRANSIENT,
      value: TRANSIENT_VALUE,
      retries: 0,
      budgetExhausted: true,
    });
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it("does not sleep when the next delay exceeds the remaining retry budget", async () => {
    const delays: number[] = [];
    let currentTime = 0;
    let attempts = 0;

    const outcome = await retryOnTransient(
      async () => {
        attempts += 1;
        currentTime = FIRST_DELAY_MS;
        return { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE };
      },
      {
        retries: TWO_RETRIES,
        backoffMs: [SECOND_DELAY_MS],
        retryBudgetMs: FINITE_BUDGET_MS,
        now: () => currentTime,
        sleep: createSleep(delays),
      },
    );

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.TRANSIENT,
      value: TRANSIENT_VALUE,
      retries: 0,
      budgetExhausted: true,
    });
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it("allows a retry when a finite retry budget covers the next delay", async () => {
    const delays: number[] = [];
    let currentTime = 0;
    const attempt = createAttempt([
      { class: INTERNAL_CLASSES.TRANSIENT, value: TRANSIENT_VALUE },
      { class: INTERNAL_CLASSES.SUCCESS, value: SUCCESS_VALUE },
    ]);

    const outcome = await retryOnTransient(attempt, {
      retries: TWO_RETRIES,
      backoffMs: [FIRST_DELAY_MS],
      retryBudgetMs: FINITE_BUDGET_MS,
      now: () => currentTime,
      sleep: async (ms) => {
        delays.push(ms);
        currentTime += ms;
      },
    });

    expect(outcome).toEqual({
      class: INTERNAL_CLASSES.SUCCESS,
      value: SUCCESS_VALUE,
      retries: 1,
      budgetExhausted: false,
    });
    expect(delays).toEqual([FIRST_DELAY_MS]);
  });
});
