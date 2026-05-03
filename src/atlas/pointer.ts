export const POINTER_KINDS = {
  LIFECYCLE: "lifecycle",
  THOUGHTS: "thoughts",
  PROJECT_MEMORY: "pm",
  MINDMODEL: "mindmodel",
  CODE: "code",
} as const;

export type PointerKind = (typeof POINTER_KINDS)[keyof typeof POINTER_KINDS];

export interface SourcePointer {
  readonly kind: PointerKind;
  readonly value: string;
}

const KIND_VALUES = Object.values(POINTER_KINDS) as readonly string[];

export function parsePointer(raw: string): SourcePointer {
  const idx = raw.indexOf(":");
  if (idx === -1) throw new Error(`invalid pointer: ${raw}`);
  const prefix = raw.slice(0, idx);
  if (!KIND_VALUES.includes(prefix)) throw new Error(`unknown pointer kind: ${prefix}`);
  return { kind: prefix as PointerKind, value: raw.slice(idx + 1) };
}

export function formatPointer(pointer: SourcePointer): string {
  return `${pointer.kind}:${pointer.value}`;
}

export function tryParsePointer(raw: string): SourcePointer | null {
  try {
    return parsePointer(raw);
  } catch {
    return null;
  }
}
