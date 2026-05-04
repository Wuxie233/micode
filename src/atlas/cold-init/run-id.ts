import { randomBytes } from "node:crypto";

import { COLD_INIT_RUN_ID_PREFIX } from "@/atlas/cold-init/config";

const RANDOM_BYTES = 4;
const TIMESTAMP_RADIX = 36;

export function createColdInitRunId(): string {
  const ts = Date.now().toString(TIMESTAMP_RADIX);
  const rnd = randomBytes(RANDOM_BYTES).toString("hex");
  return `${COLD_INIT_RUN_ID_PREFIX}-${ts}-${rnd}`;
}
