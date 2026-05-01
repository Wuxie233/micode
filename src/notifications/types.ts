export const NOTIFICATION_STATUSES = {
  COMPLETED: "completed",
  BLOCKED: "blocked",
  FAILED_STOP: "failed_stop",
} as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[keyof typeof NOTIFICATION_STATUSES];

export interface PrivateTarget {
  readonly kind: "private";
  readonly userId: string;
}

export interface GroupTarget {
  readonly kind: "group";
  readonly groupId: string;
}

export type NotificationTarget = PrivateTarget | GroupTarget;

export interface NotificationRequest {
  readonly key: string;
  readonly status: NotificationStatus;
  readonly title: string;
  readonly summary: string;
  readonly reference: string | null;
  readonly target: NotificationTarget;
}

export interface NotificationContext {
  readonly issueNumber?: number;
  readonly issueUrl?: string;
  readonly sessionId?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly reference?: string | null;
}
