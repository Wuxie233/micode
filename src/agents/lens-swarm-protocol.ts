export const LENS_SWARM_PROTOCOL = `<lens-swarm-protocol priority="high" description="Read-only multi-lens discovery and adversarial review protocol">
<purpose>
Lens Swarm protocol is a read-only discovery/review mechanism, not an execution mechanism. A coordinator may fan out multiple narrow-lens scout agents to collect risks, boundaries, regression surfaces, and improvement suggestions before synthesis. The swarm does not mutate files; scouts do not run implementer/reviewer loops, do not commit, deploy, restart, or advance lifecycle state.
</purpose>

<when-to-use>
<discovery-swarm>
Use Discovery Swarm before planner for complex design or workflow-sensitive work: agent prompts, lifecycle/runtime/deploy/recovery, planner/executor/reviewer contracts, new agents/protocols/review policy, cross-module changes spanning three or more entrypoints, security/secrets/safety surfaces, or when the user explicitly asks for multiple angles before design.
</discovery-swarm>
<adversarial-swarm>
Use Adversarial Swarm for generalized adversarial requests such as "对抗性审一下", "找几个 sub 看看", "红队过一下" when the user did not explicitly name a critic role. Select complementary lenses and synthesize findings back to the user. Stop in discussion; never auto-advance to lifecycle/planner/executor after adversarial review.
</adversarial-swarm>
<critic-compatibility>
explicit critic-role compatibility: when the user explicitly names critic or one of the existing critic roles (archaeologist, conservative, redteam, yagni, cross-family), preserve the critic route and pass that role. If the user asks for both swarm and critic redteam, run both and separate scout findings from critic findings in synthesis.
</critic-compatibility>
</when-to-use>

<default-lens-pool>
- history-archaeology: prior prompt/workflow history, decisions, and constraints.
- entrypoint-boundary: every entry path, compatibility boundary, and routing surface.
- regression-drift-guard: tests, docs, AGENTS.md mirrors, and prompt drift risks.
- safety-recovery: lifecycle, secrets, runtime, rollback, recovery, and operational risks.
- minimal-scope-yagni: smallest viable version; remove speculative knobs and abstractions.
- contract-integration: planner/executor/reviewer contract closure and context-brief propagation.
</default-lens-pool>

<scout-output-contract>
Every scout receives exactly one lens and a scoped excerpt. Output must be short, evidence-backed, and actionable:
- Lens: <lens id>
- Findings: severity-tagged bullets with evidence or explicit Cannot Assess.
- Cannot Assess: missing evidence and what would resolve it.
- Suggested synthesis notes: concise notes for the coordinator.
Scouts never emit APPROVED / CHANGES REQUESTED because they are not reviewer-loop agents.
</scout-output-contract>

<coordinator-synthesis>
coordinator synthesis: The coordinator owns synthesis: dedupe findings, rank by risk, state which findings are 采纳, which are 不采纳 with reason, and which remain Cannot Assess. Adopted Discovery Swarm findings must enter design Constraints / Approach / Components / Testing Strategy / Open Questions. Adopted Adversarial Swarm findings must be summarized to the user and the coordinator must wait for explicit go/proceed before lifecycle/planner/executor.
</coordinator-synthesis>
</lens-swarm-protocol>`;
