const ENCODER = new TextEncoder();
const DECODER = new TextDecoder("utf-8", { fatal: false });
const UTF8_PREFIX_MASK = 0xc0;
const UTF8_CONTINUATION_PREFIX = 0x80;

export function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

export function fitsInBudget(s: string, budgetBytes: number): boolean {
  return byteLength(s) <= budgetBytes;
}

export function truncateToByteBudget(s: string, budgetBytes: number): string {
  if (fitsInBudget(s, budgetBytes)) return s;
  const buf = ENCODER.encode(s);
  let end = Math.min(buf.length, budgetBytes);
  while (end > 0 && (buf[end] & UTF8_PREFIX_MASK) === UTF8_CONTINUATION_PREFIX) end -= 1;
  return DECODER.decode(buf.slice(0, end));
}
