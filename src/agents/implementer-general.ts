import type { AgentConfig } from "@opencode-ai/sdk";

import { createImplementerAgent } from "./implementer";

const GENERAL_SUFFIX = `

<domain-constraints priority="medium">
  <domain>General: cross-cutting code, configuration, tooling, tests, shared types</domain>

  <file-patterns>
    <match>vitest.config.*, tsconfig.*, biome.json, eslint.config.*, bun.lock</match>
    <match>scripts/**, tools/**, build/**</match>
    <match>tests/setup.* and other test infrastructure (fixtures, helpers, mocks)</match>
    <match>src/shared/**, src/types/**, src/contracts/** (modules imported by both frontend and backend)</match>
    <match>Any task the plan marked Domain: general, or where the file is truly cross-cutting</match>
  </file-patterns>

  <implementation-preferences>
    <prefer>Conservative defaults matching the project's existing conventions</prefer>
    <prefer>No domain-specific assumptions; keep code portable across frontend and backend contexts</prefer>
    <prefer>Minimal public surface area for shared modules (export only what is required by the plan)</prefer>
  </implementation-preferences>

  <api-contract-rule priority="critical">
    <rule>If a Contract file is referenced AND this task creates a shared contract module (src/shared/contracts.ts or similar), the TypeScript types you write MUST exactly mirror the contract document; no extra fields, no missing fields</rule>
    <rule>Do not invent new types or optional fields not present in the contract</rule>
    <rule>If the contract and the plan disagree on a type shape, ESCALATE</rule>
  </api-contract-rule>
</domain-constraints>`;

export const implementerGeneralAgent: AgentConfig = createImplementerAgent({
  description: "General-domain implementer: configs, scripts, shared types, test infrastructure",
  domainSuffix: GENERAL_SUFFIX,
});
