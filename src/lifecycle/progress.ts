import type { Resolver } from "./resolver";
import type { LifecycleRunner } from "./runner";

export const PROGRESS_KINDS = {
  DECISION: "decision",
  BLOCKER: "blocker",
  DISCOVERY: "discovery",
  STATUS: "status",
  HANDOFF: "handoff",
} as const;

export type ProgressKind = (typeof PROGRESS_KINDS)[keyof typeof PROGRESS_KINDS];

const PROGRESS_KIND_VALUES = Object.values(PROGRESS_KINDS) as readonly string[];
const PROGRESS_MARKER_PREFIX = "<!-- micode:lifecycle:progress";
const RECENT_PROGRESS_LIMIT = 10;
const OK_EXIT_CODE = 0;
const ISSUE_VIEW_FIELDS = "body,comments";
const NO_ACTIVE_LIFECYCLE = "no_active_lifecycle";
const AMBIGUOUS_ACTIVE_LIFECYCLE = "ambiguous_active_lifecycle";
const URL_PREFIX = "https://";

export interface ProgressInput {
  readonly issueNumber?: number;
  readonly kind: ProgressKind;
  readonly summary: string;
  readonly details?: string;
  readonly marker?: string;
}

export interface ProgressOutcome {
  readonly issueNumber: number;
  readonly kind: ProgressKind;
  readonly commentUrl: string | null;
}

export interface ProgressEntry {
  readonly kind: ProgressKind;
  readonly summary: string;
  readonly createdAt: string;
  readonly url: string | null;
}

export interface ContextSnapshot {
  readonly issueNumber: number;
  readonly body: string;
  readonly recentProgress: readonly ProgressEntry[];
}

export interface ProgressLoggerDeps {
  readonly runner: LifecycleRunner;
  readonly resolver: Resolver;
  readonly cwd: string;
  readonly now?: () => Date;
}

export interface ProgressLogger {
  readonly log: (input: ProgressInput) => Promise<ProgressOutcome>;
  readonly context: (input?: { issueNumber?: number }) => Promise<ContextSnapshot>;
}

const formatBody = (
  kind: ProgressKind,
  summary: string,
  details: string | undefined,
  when: Date,
  marker: string | undefined,
): string => {
  const isoStamp = when.toISOString();
  const detailsBlock = details ? `\n\n<details>\n${details}\n</details>` : "";
  const head = marker && marker.length > 0 ? `${marker}\n` : "";
  return `${head}${PROGRESS_MARKER_PREFIX} kind=${kind} at=${isoStamp} -->\n## ${kind.toUpperCase()} - ${isoStamp}\n\n${summary}${detailsBlock}`;
};

const resolveIssueNumber = async (deps: ProgressLoggerDeps, explicit: number | undefined): Promise<number> => {
  if (typeof explicit === "number") return explicit;
  const result = await deps.resolver.current();
  if (result.kind === "resolved") return result.record.issueNumber;
  if (result.kind === "none") {
    throw new Error(`${NO_ACTIVE_LIFECYCLE}: pass issue_number explicitly or run lifecycle_resume first`);
  }
  throw new Error(`${AMBIGUOUS_ACTIVE_LIFECYCLE}: candidates=${result.candidates.join(",")}`);
};

interface ParsedComment {
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
}

interface ParsedView {
  readonly body: string;
  readonly comments: readonly ParsedComment[];
}

const parseCommentEntry = (raw: unknown): ParsedComment | null => {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { body?: unknown; createdAt?: unknown; url?: unknown };
  if (typeof candidate.body !== "string") return null;
  return {
    body: candidate.body,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    url: typeof candidate.url === "string" ? candidate.url : "",
  };
};

const parseCommentsJson = (stdout: string): ParsedView => {
  try {
    const raw: unknown = JSON.parse(stdout);
    if (raw && typeof raw === "object") {
      const obj = raw as { body?: unknown; comments?: unknown };
      const body = typeof obj.body === "string" ? obj.body : "";
      const comments = Array.isArray(obj.comments)
        ? obj.comments.flatMap((c) => {
            const parsed = parseCommentEntry(c);
            return parsed ? [parsed] : [];
          })
        : [];
      return { body, comments };
    }
  } catch {
    // Older gh emits plain text rather than JSON.
  }
  return { body: stdout, comments: [] };
};

const KIND_PATTERN = /kind=([a-z]+)/;

const isProgressKind = (value: string): value is ProgressKind => PROGRESS_KIND_VALUES.includes(value);

const summaryLineFrom = (body: string): string => {
  const lines = body.split("\n");
  const candidate = lines.find((line) => line.length > 0 && !line.startsWith("<!--") && !line.startsWith("##"));
  return candidate?.trim() ?? "";
};

const progressMarkerLineFrom = (body: string): string | undefined =>
  body.split("\n").find((line) => line.startsWith(PROGRESS_MARKER_PREFIX));

const extractEntry = (comment: ParsedComment): ProgressEntry | null => {
  const marker = progressMarkerLineFrom(comment.body);
  if (!marker) return null;
  const kindMatch = KIND_PATTERN.exec(marker);
  const candidate = kindMatch?.[1];
  if (!candidate || !isProgressKind(candidate)) return null;

  return {
    kind: candidate,
    summary: summaryLineFrom(comment.body),
    createdAt: comment.createdAt,
    url: comment.url ? comment.url : null,
  };
};

const extractCommentUrl = (stdout: string): string | null => {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith(URL_PREFIX)) return trimmed;
  return null;
};

export function createProgressLogger(deps: ProgressLoggerDeps): ProgressLogger {
  const now = deps.now ?? ((): Date => new Date());

  return {
    async log(input: ProgressInput): Promise<ProgressOutcome> {
      const issueNumber = await resolveIssueNumber(deps, input.issueNumber);
      const body = formatBody(input.kind, input.summary, input.details, now(), input.marker);
      const run = await deps.runner.gh(["issue", "comment", String(issueNumber), "--body", body], {
        cwd: deps.cwd,
      });
      const url = run.exitCode === OK_EXIT_CODE ? extractCommentUrl(run.stdout) : null;
      return { issueNumber, kind: input.kind, commentUrl: url };
    },

    async context(input): Promise<ContextSnapshot> {
      const issueNumber = await resolveIssueNumber(deps, input?.issueNumber);
      const view = await deps.runner.gh(["issue", "view", String(issueNumber), "--json", ISSUE_VIEW_FIELDS], {
        cwd: deps.cwd,
      });
      const parsed = parseCommentsJson(view.stdout);
      const entries: ProgressEntry[] = [];
      for (const comment of parsed.comments) {
        const entry = extractEntry(comment);
        if (entry) entries.push(entry);
      }
      const recent = entries.slice(-RECENT_PROGRESS_LIMIT);
      return { issueNumber, body: parsed.body, recentProgress: recent };
    },
  };
}
