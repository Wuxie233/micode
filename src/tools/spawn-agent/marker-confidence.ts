export const MARKER_CONFIDENCE = {
  ABSENT: "absent",
  NARRATIVE: "narrative",
  FINAL: "final",
} as const;

export type MarkerConfidence = (typeof MARKER_CONFIDENCE)[keyof typeof MARKER_CONFIDENCE];

export interface MarkerClassification {
  readonly confidence: MarkerConfidence;
  readonly marker: string | null;
}

const FENCE_PATTERN = /```[\s\S]*?```/g;
const SPACE_BOUNDARY = " ";
const COLON_BOUNDARY = ":";
const LINE_SEPARATOR_WIDTH = 1;

function stripFenced(value: string): string {
  return value.replace(FENCE_PATTERN, "");
}

function findFirstMarker(value: string, markers: readonly string[]): string | null {
  let earliest: { marker: string; index: number } | null = null;
  for (const marker of markers) {
    const idx = value.indexOf(marker);
    if (idx === -1) continue;
    if (earliest === null || idx < earliest.index) earliest = { marker, index: idx };
  }
  return earliest?.marker ?? null;
}

function isAnchoredMarker(value: string, marker: string): boolean {
  return (
    value === marker || value.startsWith(`${marker}${SPACE_BOUNDARY}`) || value.startsWith(`${marker}${COLON_BOUNDARY}`)
  );
}

function findAnchoredMarkerIndex(value: string, marker: string): number | null {
  let offset = 0;
  for (const line of value.split(/\r?\n/)) {
    const anchored = line.trimStart();
    if (isAnchoredMarker(anchored, marker)) return offset + line.length - anchored.length;
    offset += line.length + LINE_SEPARATOR_WIDTH;
  }
  return null;
}

function findFirstAnchoredMarker(value: string, markers: readonly string[]): string | null {
  let earliest: { marker: string; index: number } | null = null;
  for (const marker of markers) {
    const idx = findAnchoredMarkerIndex(value, marker);
    if (idx === null) continue;
    if (earliest === null || idx < earliest.index) earliest = { marker, index: idx };
  }
  return earliest?.marker ?? null;
}

export function classifyMarker(value: string, markers: readonly string[]): MarkerClassification {
  const marker = findFirstMarker(value, markers);
  if (marker === null) return { confidence: MARKER_CONFIDENCE.ABSENT, marker: null };

  const stripped = stripFenced(value);
  const finalMarker = findFirstAnchoredMarker(stripped, markers);
  if (finalMarker !== null) return { confidence: MARKER_CONFIDENCE.FINAL, marker: finalMarker };

  return { confidence: MARKER_CONFIDENCE.NARRATIVE, marker };
}
