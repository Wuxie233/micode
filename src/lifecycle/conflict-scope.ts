import { isDirectlyRelatedResolverPath } from "./conflict-context";

export type ConflictResolverScopeResult =
  | { readonly status: "allowed"; readonly extraFiles: readonly string[]; readonly reasons: readonly string[] }
  | {
      readonly status: "blocked";
      readonly reason: "unrelated_files" | "too_many_extra_files";
      readonly extraFiles: readonly string[];
      readonly blockedFiles: readonly string[];
      readonly reasons: readonly string[];
    };

export interface ConflictResolverScopeInput {
  readonly conflictFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
  readonly maxExtraFiles?: number;
}

const DEFAULT_MAX_EXTRA_FILES = 3;

const normalize = (path: string): string => path.replaceAll("\\", "/").replace(/^\.\//, "");

const unique = (items: readonly string[]): readonly string[] => [...new Set(items.map(normalize))];

const directory = (path: string): string => {
  const normalized = normalize(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
};

const stem = (path: string): string => {
  const normalized = normalize(path);
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  return name.replace(/(\.test)?\.[^.]+$/, "");
};

const reasonFor = (file: string, conflictFiles: readonly string[]): string => {
  const directTest = conflictFiles.find(
    (conflict) => stem(conflict) === stem(file) && /(^|\/)tests?\/|\.test\./.test(file),
  );
  if (directTest) return `${file}: direct test for conflicted file ${directTest}`;
  const sameDir = conflictFiles.find((conflict) => directory(conflict) === directory(file));
  if (sameDir) return `${file}: type/schema/call-site in conflicted directory ${directory(sameDir)}`;
  return `${file}: directly related to conflicted files`;
};

export function evaluateConflictResolverScope(input: ConflictResolverScopeInput): ConflictResolverScopeResult {
  const conflictFiles = unique(input.conflictFiles);
  const modifiedFiles = unique(input.modifiedFiles);
  const maxExtraFiles = input.maxExtraFiles ?? DEFAULT_MAX_EXTRA_FILES;
  const extraFiles = modifiedFiles.filter((file) => !conflictFiles.includes(file));
  const blockedFiles = extraFiles.filter((file) => !isDirectlyRelatedResolverPath(file, conflictFiles));
  const reasons = extraFiles
    .filter((file) => !blockedFiles.includes(file))
    .map((file) => reasonFor(file, conflictFiles));

  if (blockedFiles.length > 0) {
    return { status: "blocked", reason: "unrelated_files", extraFiles, blockedFiles, reasons };
  }
  if (extraFiles.length > maxExtraFiles) {
    return { status: "blocked", reason: "too_many_extra_files", extraFiles, blockedFiles: [], reasons };
  }
  return { status: "allowed", extraFiles, reasons };
}
