# Domain Concepts

## Rules
- Use consistent terms: mindmodel, manifest, constraints, artifacts, ledger, milestone, Octto session, PTY, MCP.
- Keep workflows aligned with the mindmodel generation pipeline and artifact indexing.
- Model Octto sessions with questions, answers, and session lifecycle states.

## Examples

### Mindmodel Workflow
```ts
const manifest = loadMindmodelManifest();
const constraints = loadConstraints();
```

### Artifact Indexing
```ts
await ingestMilestoneArtifact({
  milestoneId,
  artifactType,
  payload
});
```

### Octto Session
```ts
const session = await createSession({
  title,
  questions
});
```

## Anti-patterns

### Mixed Terminology
```ts
// BAD: inconsistent naming
const modelSpec = loadMindmodelManifest();
```

### Skipping Artifacts
```ts
// BAD: no artifact indexing
await processMilestone();
```
