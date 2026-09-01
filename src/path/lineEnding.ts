/**
 * DocForce generated-artifact line-ending policy.
 *
 * Generated textual artifacts (Markdown, Mermaid, reports, and other
 * DocForce-owned text) use LF (`\n`) on every platform. This keeps
 * hashes, update idempotency, and model-adjacent fingerprints identical
 * across Linux and Windows.
 *
 * Consumer source files are never rewritten to change line endings.
 * Only text DocForce generates or hashes as managed-section content
 * follows this policy.
 *
 * Managed-section hashes canonicalize CRLF/CR to LF before hashing, so
 * line-ending-only differences do not stale a proposal. Any other edit
 * still invalidates the baseline hash.
 */
export const GENERATED_LINE_ENDING = "\n";

export function canonicalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function toGeneratedText(text: string): string {
  return canonicalizeNewlines(text);
}
