import { describe, expect, it } from "bun:test";

import {
  ATLAS_ARCHIVE_DIR,
  ATLAS_CHALLENGE_CAP_PER_RUN,
  ATLAS_DECISIONS_DIR,
  ATLAS_IMPL_DIR,
  ATLAS_META_DIR,
  ATLAS_RECENT_HUMAN_EDIT_LIFECYCLE_WINDOW,
  ATLAS_ROOT_DIRNAME,
  ATLAS_SCHEMA_VERSION,
  ATLAS_STAGING_DIR,
  ATLAS_STALE_LOCK_MS,
  ATLAS_WORKER_CONCURRENCY_MAX,
} from "@/atlas/config";

describe("atlas config", () => {
  it("exposes the vault root directory name", () => {
    expect(ATLAS_ROOT_DIRNAME).toBe("atlas");
  });

  it("uses numeric prefixes for top level directories", () => {
    expect(ATLAS_IMPL_DIR).toBe("10-impl");
    expect(ATLAS_DECISIONS_DIR).toBe("40-decisions");
    expect(ATLAS_ARCHIVE_DIR).toBe("_archive");
    expect(ATLAS_META_DIR).toBe("_meta");
    expect(ATLAS_STAGING_DIR).toBe("staging");
  });

  it("declares schema version one for phase two", () => {
    expect(ATLAS_SCHEMA_VERSION).toBe(1);
  });

  it("caps challenge volume per run", () => {
    expect(ATLAS_CHALLENGE_CAP_PER_RUN).toBe(20);
  });

  it("caps worker concurrency at six", () => {
    expect(ATLAS_WORKER_CONCURRENCY_MAX).toBe(6);
  });

  it("declares the recent human edit lifecycle window", () => {
    expect(ATLAS_RECENT_HUMAN_EDIT_LIFECYCLE_WINDOW).toBe(5);
  });

  it("declares stale lock reclamation window in milliseconds", () => {
    expect(ATLAS_STALE_LOCK_MS).toBe(30 * 60 * 1000);
  });
});
