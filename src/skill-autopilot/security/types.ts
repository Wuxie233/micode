export interface GateInput {
  readonly name: string;
  readonly description: string;
  readonly trigger: string;
  readonly steps: readonly string[];
  readonly body: string;
  readonly frontmatter: Record<string, unknown>;
}

export type GateResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };
