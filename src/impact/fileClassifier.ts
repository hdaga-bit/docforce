export type FileCategory =
  | "source"
  | "test"
  | "configuration"
  | "infrastructure"
  | "documentation"
  | "generated-documentation"
  | "docforce-internal"
  | "unknown";

export interface ClassifiedFileChange {
  readonly path: string;
  readonly changeType: import("./types.js").ChangeType;
  readonly oldPath?: string;
  readonly category: FileCategory;
}

const CLASSIFICATION_RULES: { test: (path: string) => boolean; category: FileCategory }[] = [
  { test: (p) => p.startsWith("docs/generated/") || p.startsWith(".docforce/"), category: "generated-documentation" },
  {
    test: (p) =>
      p.startsWith("src/docforce/")
      || p.startsWith("packages/docforce/")
      || p.startsWith("node_modules/")
      || p.includes("/node_modules/"),
    category: "docforce-internal",
  },
  { test: (p) => p.endsWith(".test.ts") || p.endsWith(".test.js") || p.endsWith(".spec.ts") || p.endsWith(".spec.js"), category: "test" },
  { test: (p) => p.endsWith(".ts") || p.endsWith(".js") || p.endsWith(".tsx") || p.endsWith(".jsx"), category: "source" },
  { test: (p) => p === "docforce.yml" || p === "tsconfig.json" || p === "tsconfig.build.json" || p === "package.json" || p === "package-lock.json" || p.endsWith(".env") || p.endsWith(".env.example"), category: "configuration" },
  { test: (p) => p === "Dockerfile" || p.startsWith("docker-compose") || p.endsWith(".service") || p.startsWith(".github/"), category: "infrastructure" },
  { test: (p) => p.endsWith(".md") || p.endsWith(".txt") || p.startsWith("docs/"), category: "documentation" },
];

export function classifyFile(path: string): FileCategory {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.test(path)) return rule.category;
  }
  return "unknown";
}

export function classifyFileChanges(
  changes: readonly import("./types.js").FileChange[],
): ClassifiedFileChange[] {
  return changes.map((fc) => ({
    ...fc,
    category: classifyFile(fc.path),
  }));
}

/**
 * Filter file changes to only those relevant for product impact analysis.
 * Excludes generated-documentation and docforce-internal files.
 */
export function getProductRelevantChanges(
  classified: readonly ClassifiedFileChange[],
): ClassifiedFileChange[] {
  return classified.filter((f) =>
    f.category !== "generated-documentation" &&
    f.category !== "docforce-internal",
  );
}
