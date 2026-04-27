export interface ModelReference {
  readonly providerID: string;
  readonly modelID: string;
}

interface Candidate {
  readonly model: string;
  readonly rank: number;
}

const EDGE_PATTERN = /^[`'"“”‘’()（）[\]【】]+|[`'"“”‘’()（）[\]【】.,，。]+$/gu;
const NORMALIZE_PATTERN = /[^a-z0-9]+/g;
const RANK_FULL_EXACT = 0;
const RANK_ID_EXACT = 1;
const RANK_ID_PREFIX = 2;
const RANK_FULL_PREFIX = 3;
const RANK_ID_CONTAINS = 4;
const RANK_FULL_CONTAINS = 5;

function cleanModel(value: string): string {
  return value.trim().replace(EDGE_PATTERN, "");
}

function normalizeModel(value: string): string {
  return value.toLowerCase().replace(NORMALIZE_PATTERN, "");
}

export function parseModelReference(model: string): ModelReference | null {
  const trimmed = model.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  if (slash === trimmed.length - 1) return null;
  return { providerID: trimmed.slice(0, slash), modelID: trimmed.slice(slash + 1) };
}

function scoreModel(full: string, id: string, query: string): number | null {
  if (full === query) return RANK_FULL_EXACT;
  if (id === query) return RANK_ID_EXACT;
  if (id.startsWith(query)) return RANK_ID_PREFIX;
  if (full.startsWith(query)) return RANK_FULL_PREFIX;
  if (id.includes(query)) return RANK_ID_CONTAINS;
  if (full.includes(query)) return RANK_FULL_CONTAINS;
  return null;
}

function rankModel(model: string, query: string): Candidate | null {
  const reference = parseModelReference(model);
  if (!reference) return null;
  const rank = scoreModel(normalizeModel(model), normalizeModel(reference.modelID), query);
  return rank === null ? null : { model, rank };
}

function chooseModel(candidates: readonly Candidate[]): string | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort(
    (left, right) =>
      left.rank - right.rank || left.model.length - right.model.length || left.model.localeCompare(right.model),
  );
  return ranked[0]?.model ?? null;
}

export function resolveModelName(model: string, availableModels: ReadonlySet<string>): string | null {
  const cleaned = cleanModel(model);
  if (availableModels.has(cleaned)) return cleaned;
  if (availableModels.size === 0) return parseModelReference(cleaned) ? cleaned : null;
  const query = normalizeModel(cleaned);
  const candidates = [...availableModels].flatMap((available) => {
    const candidate = rankModel(available, query);
    return candidate ? [candidate] : [];
  });
  return chooseModel(candidates);
}

export function resolveModelReference(model: string, availableModels: ReadonlySet<string>): ModelReference | null {
  const resolved = resolveModelName(model, availableModels);
  return resolved ? parseModelReference(resolved) : null;
}
