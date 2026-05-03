import { existsSync, statSync } from "node:fs";

import { readPage } from "./page-reader";

export interface MtimeDetectResult {
  readonly edited: boolean;
  readonly reason: "missing" | "match" | "drift";
  readonly fileMtime: number;
  readonly recordedMtime: number;
}

export async function detectHumanEdit(path: string): Promise<MtimeDetectResult> {
  if (!existsSync(path)) return { edited: false, reason: "missing", fileMtime: 0, recordedMtime: 0 };
  const node = await readPage(path);
  if (node === null) return { edited: false, reason: "missing", fileMtime: 0, recordedMtime: 0 };
  const fileMtime = Math.trunc(statSync(path).mtimeMs);
  const recordedMtime = Math.trunc(node.frontmatter.last_written_mtime);
  if (fileMtime === recordedMtime) return { edited: false, reason: "match", fileMtime, recordedMtime };
  return { edited: true, reason: "drift", fileMtime, recordedMtime };
}
