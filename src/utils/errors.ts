// src/utils/errors.ts
// Unified error handling utilities
// Used by tools and hooks for consistent error formatting and logging

/**
 * Safely extract error message from unknown error type.
 * Handles Error instances, strings, and other types.
 */
export function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

/**
 * Format error message for tool responses (LLM-facing).
 * @param message - The error message
 * @param context - Optional context about what operation failed
 */
export function formatToolError(message: string, context?: string): string {
  if (context?.trim()) {
    return `Error (${context}): ${message}`;
  }
  return `Error: ${message}`;
}
