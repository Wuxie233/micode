import { which } from "bun";

/**
 * Check if btca CLI is available on the system.
 * Returns installation instructions if not found.
 */
export async function checkBtcaAvailable(): Promise<{ available: boolean; message?: string }> {
  const btcaPath = which("btca");
  if (btcaPath) {
    return { available: true };
  }
  return {
    available: false,
    message:
      "btca CLI not found. Library source code search will not work.\n" +
      "Install from: https://github.com/anthropics/btca\n" +
      "  cargo install btca",
  };
}
