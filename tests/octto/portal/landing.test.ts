import { describe, expect, it } from "bun:test";

import { renderLandingHtml } from "@/octto/portal/landing";

const POLL_INTERVAL_MS = 4321;
const BASE_URL = "https://octto.example.test";
const CONVERSATIONS_PATH = "/api/conversations";

describe("renderLandingHtml", () => {
  it("returns a self-contained HTML document with no external assets", () => {
    const html = renderLandingHtml({ pollIntervalMs: POLL_INTERVAL_MS, baseUrl: BASE_URL });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('src="//');
  });

  it("polls GET /api/conversations using the configured interval literal", () => {
    const html = renderLandingHtml({ pollIntervalMs: POLL_INTERVAL_MS, baseUrl: BASE_URL });

    expect(html).toContain(CONVERSATIONS_PATH);
    expect(html).toContain(String(POLL_INTERVAL_MS));
    expect(html).toMatch(/setInterval\([^,]+,\s*4321\s*\)/);
  });

  it("renders rows linked to /portal/{id} and exposes data-testid markers", () => {
    const html = renderLandingHtml({ pollIntervalMs: POLL_INTERVAL_MS, baseUrl: BASE_URL });

    expect(html).toContain('data-testid="conversation-row"');
    expect(html).toContain('data-testid="empty-state"');
    expect(html).toContain("/portal/");
  });

  it("references the contract field names on ConversationSummary", () => {
    const html = renderLandingHtml({ pollIntervalMs: POLL_INTERVAL_MS, baseUrl: BASE_URL });

    for (const field of ["id", "title", "createdAt", "pendingCount", "oldestPendingAgeMs", "ownerSessionId"]) {
      expect(html).toContain(field);
    }
  });

  it("includes an unauthorized stub branch for HTTP 401 responses", () => {
    const html = renderLandingHtml({ pollIntervalMs: POLL_INTERVAL_MS, baseUrl: BASE_URL });

    expect(html).toContain("401");
    expect(html).toContain("Unauthorized");
  });
});
