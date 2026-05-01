import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { NotificationRequest, NotificationTarget } from "./types";

const LOG_MODULE = "notifications";

export interface NotificationSink {
  readonly deliver: (request: NotificationRequest, renderedMessage: string) => Promise<void>;
}

export interface RecordingSink extends NotificationSink {
  readonly deliveries: ReadonlyArray<{ readonly request: NotificationRequest; readonly message: string }>;
}

export function createNoopSink(): RecordingSink {
  const deliveries: Array<{ readonly request: NotificationRequest; readonly message: string }> = [];
  return {
    deliveries,
    deliver: async (request, message) => {
      deliveries.push({ request, message });
      log.info(LOG_MODULE, `noop sink recorded ${request.status} for ${request.key}`);
    },
  };
}

export type CourierInvoke = (target: NotificationTarget, message: string) => Promise<void>;

export interface CourierSinkInput {
  readonly invoke: CourierInvoke;
}

export function createCourierSink(input: CourierSinkInput): NotificationSink {
  return {
    deliver: async (request, message) => {
      try {
        await input.invoke(request.target, message);
      } catch (error) {
        log.warn(LOG_MODULE, `courier delivery failed: ${extractErrorMessage(error)}`);
      }
    },
  };
}
