import { describe, expect, it } from "bun:test";

import { piiGate } from "@/skill-autopilot/security/pii-gate";

function inp(text: string) {
  return {
    name: "n",
    description: text,
    trigger: "t",
    steps: [text],
    body: text,
    frontmatter: { name: "n" } as Record<string, unknown>,
  };
}

describe("piiGate", () => {
  it("rejects absolute Linux paths", () => {
    expect(piiGate(inp("see /home/alice/secret.txt")).ok).toBe(false);
  });

  it("rejects internal hostnames", () => {
    expect(piiGate(inp("hit api.corp.example")).ok).toBe(false);
    expect(piiGate(inp("ssh box.internal")).ok).toBe(false);
  });

  it("rejects private IPv4 ranges", () => {
    expect(piiGate(inp("connect to 10.0.0.5")).ok).toBe(false);
    expect(piiGate(inp("connect to 172.16.0.1")).ok).toBe(false);
    expect(piiGate(inp("ping 192.168.1.1")).ok).toBe(false);
  });

  it("rejects internal Slack/JIRA/Confluence URLs", () => {
    expect(piiGate(inp("https://acme.slack.com/archives/C123")).ok).toBe(false);
    expect(piiGate(inp("https://acme.atlassian.net/browse/X-1")).ok).toBe(false);
  });

  it("passes on neutral content", () => {
    expect(piiGate(inp("run the linter then commit")).ok).toBe(true);
  });
});
