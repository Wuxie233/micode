import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { composeMessage } from "./composer";
import type { NotificationSink } from "./delivery";
import type { Policy, PolicyConfig } from "./policy";
import type { NotificationRequest, NotificationStatus, NotificationTarget } from "./types";

const LOG_MODULE = "notifications";

export interface NotifyInput {
  readonly status: NotificationStatus;
  readonly issueNumber?: number;
  readonly sessionId?: string;
  readonly title: string;
  readonly summary: string;
  readonly reference: string | null;
}

export interface CompletionNotifier {
  readonly notify: (input: NotifyInput) => Promise<void>;
}

export interface NotifierInput {
  readonly config: PolicyConfig;
  readonly sink: NotificationSink;
  readonly policy: Policy;
}

const toEvaluation = (event: NotifyInput): Parameters<Policy["evaluate"]>[0] => {
  return {
    status: event.status,
    ...(event.issueNumber !== undefined ? { issueNumber: event.issueNumber } : {}),
    ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
  };
};

const toRequest = (event: NotifyInput, key: string, target: NotificationTarget): NotificationRequest => {
  return {
    key,
    status: event.status,
    title: event.title,
    summary: event.summary,
    reference: event.reference,
    target,
  };
};

export function createNotifier(input: NotifierInput): CompletionNotifier {
  const notify = async (event: NotifyInput): Promise<void> => {
    try {
      const evaluation = toEvaluation(event);
      const decision = input.policy.evaluate(evaluation);
      if (decision.kind !== "notify") return;

      const message = composeMessage({
        status: event.status,
        title: event.title,
        summary: event.summary,
        reference: event.reference,
        maxSummaryChars: input.config.maxSummaryChars,
      });
      await input.sink.deliver(toRequest(event, decision.key, decision.target), message);
      input.policy.commit(evaluation);
    } catch (error) {
      log.warn(LOG_MODULE, `notify failed: ${extractErrorMessage(error)}`);
    }
  };

  return { notify };
}
