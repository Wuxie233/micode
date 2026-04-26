import { describe, expect, it } from "bun:test";

import {
  createPreservedRegistry,
  type PreservedRecord,
  type PreserveInput,
} from "../../../src/tools/spawn-agent/registry";
import { SPAWN_OUTCOMES } from "../../../src/tools/spawn-agent/types";

const AGENT = "implementer-general";
const DESCRIPTION = "Preserved task";
const MAX_RESUMES = 2;
const TTL_HOURS = 1;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

const createRecord = (sessionId: string): PreserveInput => ({
  sessionId,
  agent: AGENT,
  description: DESCRIPTION,
  outcome: SPAWN_OUTCOMES.TASK_ERROR,
});

const expectGeneratedRecord = (record: PreservedRecord, input: PreserveInput, before: number, after: number): void => {
  expect(record).toMatchObject(input);
  expect(record.preservedAt).toBeGreaterThanOrEqual(before);
  expect(record.preservedAt).toBeLessThanOrEqual(after);
  expect(record.resumeCount).toBe(0);
};

describe("createPreservedRegistry", () => {
  it("preserves records and returns them by session id", () => {
    const registry = createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });
    const record = createRecord("session-preserved");
    const before = Date.now();

    const preserved = registry.preserve(record);
    const after = Date.now();

    expectGeneratedRecord(preserved, record, before, after);
    expect(registry.get(record.sessionId)).toEqual(preserved);
    expect(registry.size()).toBe(1);
  });

  it("sweeps records older than the configured ttl", () => {
    const registry = createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });
    const record = createRecord("session-expired");

    const preserved = registry.preserve(record);

    expect(registry.sweep(preserved.preservedAt + MS_PER_HOUR)).toBe(0);
    expect(registry.get(record.sessionId)).toEqual(preserved);
    expect(registry.sweep(preserved.preservedAt + MS_PER_HOUR + 1)).toBe(1);
    expect(registry.get(record.sessionId)).toBeNull();
    expect(registry.size()).toBe(0);
  });

  it("caps resume increments at maxResumes", () => {
    const registry = createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });
    const record = createRecord("session-resume");

    registry.preserve(record);

    expect(registry.incrementResume(record.sessionId)).toBe(1);
    expect(registry.incrementResume(record.sessionId)).toBe(MAX_RESUMES);
    expect(registry.incrementResume(record.sessionId)).toBe(MAX_RESUMES);
    expect(registry.get(record.sessionId)?.resumeCount).toBe(MAX_RESUMES);
  });

  it("returns zero when incrementing a missing session", () => {
    const registry = createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });

    expect(registry.incrementResume("session-missing")).toBe(0);
  });

  it("removes records idempotently", () => {
    const registry = createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });
    const record = createRecord("session-remove");

    registry.preserve(record);

    expect(registry.remove(record.sessionId)).toBeUndefined();
    expect(registry.remove(record.sessionId)).toBeUndefined();
    expect(registry.get(record.sessionId)).toBeNull();
    expect(registry.size()).toBe(0);
  });
});
