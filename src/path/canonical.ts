import { isAbsolute, relative, resolve } from "node:path";

/**
 * Stable separator for repository-relative model, evidence, and artifact paths.
 * Filesystem I/O must convert these with `toFilesystemPath` before native APIs.
 */
export const MODEL_PATH_SEP = "/";

export function toModelPath(path: string): string {
  return path.replace(/\\/g, MODEL_PATH_SEP);
}

/**
 * Resolve a repository-relative model path to a platform-native filesystem path.
 * Does not itself enforce containment; callers must use `isPathInsideRoot`.
 */
export function toFilesystemPath(repoRoot: string, modelPath: string): string {
  const normalized = toModelPath(modelPath);
  if (normalized === "" || normalized === ".") return resolve(repoRoot);
  return resolve(repoRoot, normalized);
}

/**
 * True when `target` is inside `root` after canonical resolve/relative.
 *
 * A target is inside when the relative path:
 * - is not absolute (different Windows drive / UNC escape)
 * - is not `..` and does not begin with `../`
 * - therefore does not escape the root
 *
 * Empty relative (`target === root`) is treated as inside.
 * Comparison follows host path semantics (case-insensitive on Windows).
 */
export function isPathInsideRoot(root: string, target: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  const modelRel = toModelPath(rel);
  if (modelRel === "..") return false;
  if (modelRel.startsWith(`..${MODEL_PATH_SEP}`)) return false;
  return true;
}

/**
 * Convert an absolute or repo-relative candidate into a canonical
 * repository-relative model path, or null if it escapes `repoRoot`.
 */
export function toRepositoryRelativePath(repoRoot: string, candidate: string): string | null {
  const root = resolve(repoRoot);
  const target = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  if (!isPathInsideRoot(root, target)) return null;
  const rel = relative(root, target);
  return toModelPath(rel);
}

export function isDeclaredAbsolutePath(path: string): boolean {
  const model = toModelPath(path);
  if (isAbsolute(path) || isAbsolute(model)) return true;
  if (model.startsWith("/") || model.startsWith("//")) return true;
  if (/^[a-zA-Z]:/.test(model)) return true;
  return false;
}

/**
 * String-level rejection for declared model paths that must stay
 * repository-relative. Containment still requires `isPathInsideRoot`.
 */
export function isUnsafeDeclaredPath(path: string): boolean {
  const model = toModelPath(path.trim());
  if (model.startsWith("~")) return true;
  if (isDeclaredAbsolutePath(path)) return true;
  return false;
}

/**
 * True when `targetPath` resolves inside the repository and under at least
 * one allowed documentation root. Prefix-sibling attacks such as
 * `docs-evil/file.md` against `docs/` fail because the canonical relative
 * path from the allowed root begins with `..`.
 */
export function isPathWithinAllowedRoots(
  repoRoot: string,
  targetPath: string,
  allowedRoots: readonly string[],
): boolean {
  const model = toModelPath(targetPath);
  if (model.startsWith("~")) return false;

  const root = resolve(repoRoot);
  const target = isAbsolute(targetPath) ? resolve(targetPath) : resolve(root, targetPath);
  if (!isPathInsideRoot(root, target)) return false;

  const roots = allowedRoots.length > 0 ? allowedRoots : ["docs/"];
  return roots.some((allowed) => {
    const allowedAbs = isAbsolute(allowed) ? resolve(allowed) : resolve(root, toModelPath(allowed));
    return isPathInsideRoot(allowedAbs, target);
  });
}
