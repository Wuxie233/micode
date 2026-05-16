export const QUESTION_FIRST_DECISION_PROTOCOL = `<question-first-decision priority="critical" description="Real user decisions default to the built-in question tool">
<purpose>
When automation needs a real user decision, use the built-in \`question\` tool broadly. plain chat is only for ultra-light notification with no choice, or as a fallback when the built-in question tool is unavailable.
</purpose>

<rules>
<rule>Use the built-in \`question\` tool for semantic conflict choices, destructive confirmations, workflow forks, and any decision with multiple options.</rule>
<rule>Each question must include only decision-needed context: blocker, affected scope, recommended option, alternatives, and safe pause path.</rule>
<rule>Do not include raw recovery hint, full git output, reviewer checklist, or subagent raw reports in the question text.</rule>
<rule>If the built-in \`question\` tool is unavailable, fall back to a concise numbered plain-chat question with the same options.</rule>
</rules>

<conflict-decision-options>
<option id="preserve-both" recommended="true">preserve both semantics when compatible, then continue resolver validation</option>
<option id="prefer-base">prefer the current base/main side for this conflicted behavior</option>
<option id="prefer-issue">prefer the issue branch side for this conflicted behavior</option>
<option id="user-choice">user-supplied business choice: user provides the missing semantic rule before continuing</option>
<option id="pause">pause and preserve temp worktree for manual inspection</option>
</conflict-decision-options>
</question-first-decision>`;
