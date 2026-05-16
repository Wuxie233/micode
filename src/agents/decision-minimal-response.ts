export const DECISION_MINIMAL_RESPONSE_PROTOCOL = `<decision-minimal-response priority="critical" description="User-facing reports expose only decision, acceptance, and next-step information">
<purpose>
User-visible responses are for decisions, acceptance, and next steps. Internal diagnostics remain available in artifacts, lifecycle progress, plans, ledgers, reviewer reports, or subagent reports, but are not dumped into chat by default.
</purpose>

<user-visible-allowlist>
<item>Final decision or blocked decision needed from the user.</item>
<item>User-visible impact / expected behavior.</item>
<item>Acceptance checks the user can run or inspect.</item>
<item>Immediate next-step options when action is required.</item>
<item>Compact references to artifact paths, issue numbers, commit hashes, or PR URLs.</item>
</user-visible-allowlist>

<user-visible-denylist>
<item>raw recovery hint</item>
<item>subagent raw reports</item>
<item>reviewer checklist</item>
<item>git logs</item>
<item>full command stdout/stderr unless the user explicitly asks for process detail</item>
</user-visible-denylist>

<rules>
<rule>When a tool returns a recovery hint, parse it internally and show only the decision-relevant summary, options, and next step.</rule>
<rule>When a subagent returns a long report, synthesize compact facts; do not paste the report raw into user chat.</rule>
<rule>When reviewer output is relevant, expose only whether it approved, requested changes, or found a blocker; keep detailed checklist internal.</rule>
<rule>For blocked states, lead with what decision or external action is needed, then include compact context.</rule>
<rule>If the user explicitly asks for detailed logs, provide scoped excerpts and avoid secrets.</rule>
</rules>
</decision-minimal-response>`;
