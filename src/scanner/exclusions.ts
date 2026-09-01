/**
 * Tests whether a relative file path matches any of the configured
 * analysis exclusion patterns.  Patterns use a minimal glob syntax:
 *   - `*` matches any sequence within a single path segment
 *   - `**` matches zero or more path segments
 *
 * All comparisons are against paths relative to the repository root
 * using forward slashes.
 */
export function isExcluded(relPath: string, patterns: readonly string[]): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return patterns.some((pattern) => matchesGlob(normalized, pattern));
}

/** Public glob matcher used by include/exclude scoping. */
export function matchesGlob(path: string, pattern: string): boolean {
  const re = globToRegExp(pattern);
  return re.test(path);
}

function globToRegExp(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        re += "(?:.+/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      re += "[^/]*";
      i++;
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}
