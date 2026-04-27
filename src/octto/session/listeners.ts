import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { Session } from "./types";

export interface SessionListeners {
  readonly onSessionStarted?: (session: Session) => void;
  readonly onQuestionPushed?: (session: Session, questionId: string) => void;
  readonly onQuestionAnswered?: (session: Session, questionId: string) => void;
  readonly onSessionEnded?: (sessionId: string) => void;
}

const LOG_SCOPE = "octto.session.listeners";

function warnListenerError(label: string, error: unknown): void {
  log.warn(LOG_SCOPE, `${label} listener failed: ${extractErrorMessage(error)}`);
}

export function safelyInvoke(label: string, callback: (() => void) | undefined): void {
  if (!callback) return;

  try {
    const pending = callback();
    void Promise.resolve(pending).catch((error: unknown) => warnListenerError(label, error));
  } catch (error) {
    warnListenerError(label, error);
  }
}
