type Action = "allow" | "ask" | "deny";
type PermissionValue = Action | Record<string, Action>;
export type PermissionMap = Readonly<Record<string, PermissionValue>>;

export function questionPermissionFor(permission: PermissionMap | undefined): PermissionMap {
  if (!permission) return { question: "allow" };
  if (permission.question !== undefined) return permission;
  return { ...permission, question: "allow" };
}
