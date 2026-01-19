# Data Loading

## Rules
- Load manifests and configs from YAML via yaml and validate immediately.
- Keep parsing utilities in utils or mindmodel loader modules.
- Return null or default objects when data is missing.

## Examples

### YAML Load
```ts
import yaml from "yaml";

const data = yaml.parse(source);
```

### Loader Function
```ts
export function loadMindmodel(path: string) {
  const raw = readFileSync(path, "utf8");
  return yaml.parse(raw);
}
```

### Validation After Load
```ts
const parsed = yaml.parse(contents);
const manifest = parse(manifestSchema, parsed);
```

## Anti-patterns

### Skip Validation
```ts
// BAD: uses parsed YAML without checks
return yaml.parse(contents);
```

### Hard-coded Paths
```ts
// BAD: hard-coded filesystem paths
const raw = readFileSync("/tmp/config.yaml", "utf8");
```
