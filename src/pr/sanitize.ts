/**
 * Neutralize repository- or model-derived text before it is embedded in a
 * report surface.
 *
 * Pull-request content is untrusted. Two concrete risks are handled here:
 * an HTML comment could forge or break the stable DocForce comment marker,
 * and control characters could corrupt a Check payload. Nothing here is
 * interpreted as an instruction — it is only ever quoted as data.
 */
const MARKER_LIKE = /<!--+|--+>/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeUntrustedText(value: string, maxLength = 500): string {
  const cleaned = value
    .replace(MARKER_LIKE, "")
    .replace(CONTROL_CHARS, "")
    .replace(/\r\n?/g, "\n")
    .trim();

  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength)}…`;
}

/** Sanitize a repository path for display inside a Markdown table cell. */
export function sanitizePath(value: string, maxLength = 200): string {
  return sanitizeUntrustedText(value, maxLength).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
