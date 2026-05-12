import type { ModelReference } from "@/utils/model-selection";

export interface SessionMessageInfo {
  readonly role?: "user" | "assistant";
  readonly providerID?: string;
  readonly modelID?: string;
}

export interface SessionMessageWithInfo {
  readonly info?: SessionMessageInfo;
}

export interface SessionMessagesResult {
  readonly data?: readonly SessionMessageWithInfo[];
}

export interface OwnerModelClient {
  readonly session: {
    readonly messages: (request: { readonly path: { readonly id: string } }) => Promise<SessionMessagesResult>;
  };
}

export interface OwnerModelLookup {
  readonly resolve: (ownerSessionId: string) => Promise<ModelReference | null>;
}

interface OwnerModelLookupInput {
  readonly client: OwnerModelClient;
}

function extractModelReference(messages: readonly SessionMessageWithInfo[]): ModelReference | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const info = messages[index]?.info;
    if (info?.role !== "assistant") continue;

    const providerID = info.providerID;
    const modelID = info.modelID;
    if (typeof providerID === "string" && providerID.length > 0 && typeof modelID === "string" && modelID.length > 0) {
      return { providerID, modelID };
    }
  }

  return null;
}

export function createOwnerModelLookup(input: OwnerModelLookupInput): OwnerModelLookup {
  return {
    resolve: async (ownerSessionId) => {
      try {
        const response = await input.client.session.messages({ path: { id: ownerSessionId } });
        const messages = response.data ?? [];
        return extractModelReference(messages);
      } catch {
        return null;
      }
    },
  };
}
