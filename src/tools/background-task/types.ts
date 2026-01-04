export interface BackgroundTask {
  id: string;
  sessionID: string;
  parentSessionID: string;
  parentMessageID: string;
  description: string;
  prompt: string;
  agent: string;
  status: "running" | "completed" | "error" | "cancelled";
  startedAt: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
  progress?: {
    toolCalls: number;
    lastTool?: string;
    lastUpdate: Date;
  };
}

export interface BackgroundTaskInput {
  description: string;
  prompt: string;
  agent: string;
  parentSessionID: string;
  parentMessageID: string;
}

// API Response Types - SDK wraps responses in { data: T } format
export interface SessionCreateResponse {
  data?: {
    id?: string;
  };
}

// SessionStatus from OpenCode SDK - status is a discriminated union with 'type' field
export type SessionStatus =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy" };

// session.status() returns { data: map of sessionID -> SessionStatus }
export interface SessionStatusResponse {
  data?: {
    [sessionID: string]: SessionStatus;
  };
}

export interface MessagePart {
  type: string;
  text?: string;
}

export interface MessageInfo {
  role?: "user" | "assistant";
  sessionID?: string;
  type?: string;
  name?: string;
}

export interface SessionMessage {
  info?: MessageInfo;
  parts?: MessagePart[];
}

export interface SessionMessagesResponse {
  data?: SessionMessage[];
}
