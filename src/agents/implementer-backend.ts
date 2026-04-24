import type { AgentConfig } from "@opencode-ai/sdk";

import { createImplementerAgent } from "./implementer";

const BACKEND_SUFFIX = `

<domain-constraints priority="high">
  <domain>Backend: server-side code, data layer, infrastructure, auth</domain>

  <file-patterns>
    <match>src/api/**, src/server/**, src/routes/**, src/handlers/**</match>
    <match>*.sql, migrations/**, schema.*, prisma/**</match>
    <match>middleware/**, services/**, repositories/**, controllers/**</match>
    <match>src/lib/** when the code is server-side business logic (not UI utilities)</match>
    <match>Background jobs, queue workers, cron definitions</match>
  </file-patterns>

  <implementation-preferences>
    <prefer>Explicit input validation at API boundaries using the project's schema tool (Valibot, Zod, or equivalent)</prefer>
    <prefer>Typed errors with clear HTTP status code mapping; never leak stack traces to clients</prefer>
    <prefer>Parameterized DB queries only; no string-concatenated SQL</prefer>
    <prefer>Idempotent handlers where feasible; explicit transaction boundaries for multi-step writes</prefer>
  </implementation-preferences>

  <escalate-if>
    <situation>Task file path clearly belongs to frontend (*.tsx, *.jsx, *.vue, *.css, components/)</situation>
    <situation>Plan instructs generating UI markup, stylesheets, or client-side state management</situation>
  </escalate-if>

  <api-contract-rule priority="critical">
    <rule>If a Contract file is referenced in the task prompt, READ IT BEFORE writing any handler, route, or middleware</rule>
    <rule>Your endpoint path, HTTP method, accepted request schema, returned response shape, and error codes MUST match the contract exactly</rule>
    <rule>If you find a mismatch between plan code and contract, ESCALATE. Do NOT modify the contract; it is the shared source of truth</rule>
  </api-contract-rule>
</domain-constraints>`;

export const implementerBackendAgent: AgentConfig = createImplementerAgent({
  description: "Backend-domain implementer: APIs, DB, middleware, services, infrastructure",
  domainSuffix: BACKEND_SUFFIX,
});
