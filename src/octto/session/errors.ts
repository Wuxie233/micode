export class OcttoForbiddenError extends Error {
  readonly name = "OcttoForbiddenError" as const;

  constructor(
    readonly octtoSessionId: string,
    readonly ownerSessionID: string,
    readonly callerSessionID: string,
  ) {
    super(`Octto session ${octtoSessionId} is owned by ${ownerSessionID}, refusing access from ${callerSessionID}`);
  }
}

export function isOcttoForbiddenError(value: unknown): value is OcttoForbiddenError {
  return value instanceof OcttoForbiddenError;
}
