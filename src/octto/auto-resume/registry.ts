export interface AutoResumeRegistry {
  readonly register: (conversationId: string, ownerSessionId: string) => void;
  readonly unregister: (conversationId: string) => void;
  readonly lookup: (conversationId: string) => string | null;
}

export function createAutoResumeRegistry(): AutoResumeRegistry {
  const owners = new Map<string, string>();

  return {
    register: (conversationId, ownerSessionId) => {
      owners.set(conversationId, ownerSessionId);
    },
    unregister: (conversationId) => {
      owners.delete(conversationId);
    },
    lookup: (conversationId) => owners.get(conversationId) ?? null,
  };
}
