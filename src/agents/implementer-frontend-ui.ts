import type { AgentConfig } from "@opencode-ai/sdk";

import { createImplementerAgent } from "./implementer";

const FRONTEND_UI_SUFFIX = `

<domain-constraints priority="high">
  <domain>Frontend UI: page layout, styling, visual hierarchy, accessibility polish, animation, interaction design, and design-system use</domain>

  <file-patterns>
    <match>*.tsx, *.jsx, *.vue, *.svelte (when the task is UI/layout/visual)</match>
    <match>*.css, *.scss, *.sass, *.module.css, *.styled.ts</match>
    <match>components/**, styles/**, ui/**, pages/**, app/** (when client-facing)</match>
    <match>design-system/**, theme/**, tokens/**</match>
  </file-patterns>

  <implementation-preferences>
    <prefer>Use the project's existing design-system tokens and components; do not invent ad-hoc styles when a token exists</prefer>
    <prefer>Semantic HTML and accessible markup: correct landmarks, headings, labels, focus order, and ARIA only where semantics are insufficient</prefer>
    <prefer>Keyboard-reachable interactions, visible focus states, and color contrast that meets the project's accessibility target</prefer>
    <prefer>Responsive behavior: define behavior across the project's documented breakpoints, not just one size</prefer>
    <prefer>Motion and transitions that match the project's existing animation language; respect prefers-reduced-motion</prefer>
    <prefer>Match the project's existing CSS-in-JS or utility-first conventions; do not introduce a new styling system</prefer>
  </implementation-preferences>

  <escalate-if>
    <situation>Task file path clearly belongs to backend (src/api/, src/server/, *.sql, middleware/)</situation>
    <situation>Task is primarily frontend code-logic (state machines, data flow, form validation, complex event handling, type fixes, frontend tests). Those belong to implementer-frontend-code, not here</situation>
    <situation>Plan instructs generating server-side handlers, DB queries, or infrastructure code</situation>
  </escalate-if>

  <api-contract-rule priority="critical">
    <rule>If a Contract file is referenced in the task prompt, READ IT BEFORE writing any code that touches HTTP, WebSocket, or API calls</rule>
    <rule>Your API request URLs, HTTP methods, request body shapes, and expected response shapes MUST match the contract exactly</rule>
    <rule>If you find a mismatch between plan code and contract, ESCALATE. Do NOT modify the contract; it is the shared source of truth</rule>
  </api-contract-rule>
</domain-constraints>`;

export const implementerFrontendUiAgent: AgentConfig = createImplementerAgent({
  description: "Frontend UI implementer: page/UI/UX, layout, styling, accessibility, motion, design-system use",
  domainSuffix: FRONTEND_UI_SUFFIX,
});
