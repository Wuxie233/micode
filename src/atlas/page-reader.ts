import { existsSync, readFileSync } from "node:fs";

import { parseFrontmatter } from "./frontmatter";
import type { AtlasNode } from "./types";

const H2_PATTERN = /^## (.+)$/;
const SECTION_NAMES = ["Summary", "Connections", "Sources", "Notes"] as const;

interface Sections {
  readonly Summary: string;
  readonly Connections: string;
  readonly Sources: string;
  readonly Notes: string;
}

const splitSections = (body: string): Sections => {
  const out: Record<string, string[]> = { Summary: [], Connections: [], Sources: [], Notes: [] };
  let current: string | null = null;
  for (const line of body.split("\n")) {
    const match = H2_PATTERN.exec(line);
    if (match && SECTION_NAMES.includes(match[1] as (typeof SECTION_NAMES)[number])) {
      current = match[1];
      continue;
    }
    if (current !== null) out[current].push(line);
  }
  return {
    Summary: out.Summary.join("\n").trim(),
    Connections: out.Connections.join("\n").trim(),
    Sources: out.Sources.join("\n").trim(),
    Notes: out.Notes.join("\n").trim(),
  };
};

const collectBullets = (raw: string): readonly string[] => {
  if (raw.length === 0 || raw === "_none_") return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
};

export async function readPage(path: string): Promise<AtlasNode | null> {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const sections = splitSections(body);
  return {
    path,
    frontmatter,
    summary: sections.Summary,
    connections: collectBullets(sections.Connections),
    sourcesBody: collectBullets(sections.Sources),
    notes: sections.Notes,
  };
}
