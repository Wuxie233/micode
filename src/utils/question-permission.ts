export type PermissionMap = Record<string, unknown>;

const QUESTION_TOOL_PERMISSION = "question";
const ALLOW_PERMISSION = "allow";

export function applyDefaultQuestionPermission(permission: PermissionMap | undefined): PermissionMap {
  const merged = { ...(permission ?? {}) };
  if (Object.hasOwn(merged, QUESTION_TOOL_PERMISSION)) return merged;
  return { ...merged, [QUESTION_TOOL_PERMISSION]: ALLOW_PERMISSION };
}
