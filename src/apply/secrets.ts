/**
 * Conservative secret-pattern gate for proposed documentation.
 * Intentionally narrow to avoid flagging configuration *names*.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-[a-zA-Z0-9]{20,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{20,}\b/,
  /\bxox[baprs]-[a-zA-Z0-9-]{20,}\b/,
  /\bBearer\s+[a-zA-Z0-9._\-+/=]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export function findSecretLikeContent(text: string): string | undefined {
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return "Proposed content contains a high-confidence secret pattern (private key, API token, or bearer token)";
    }
  }
  return undefined;
}
