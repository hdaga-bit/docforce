import { readFileSync } from "node:fs";
import type { DocforceConfig } from "../config/types.js";
import type { ApiRouteInfo, Provenance } from "../model/types.js";
import { resolveScanScope, walkScopedFiles } from "./scanScope.js";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export function scanNextAppRouter(repoRoot: string, config?: DocforceConfig): ApiRouteInfo[] {
  const scope = resolveScanScope(config);
  const files = walkScopedFiles(repoRoot, scope, "source", (relPath, name) => {
    if (!name.startsWith("route.") && name !== "route.ts" && name !== "route.js" && name !== "route.tsx") {
      return false;
    }
    return /(?:^|\/)app\/api\//.test(relPath.replace(/\\/g, "/"));
  });

  const routes: ApiRouteInfo[] = [];
  for (const file of files) {
    const rel = file.relPath.replace(/\\/g, "/");
    const path = routePathFromFile(rel);
    if (!path) continue;
    const content = readFileSync(file.absPath, "utf-8");
    const methods = HTTP_METHODS.filter((m) =>
      new RegExp(
        `export\\s+(?:async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b`,
      ).test(content),
    );
    const provenance: Provenance = {
      kind: "observation",
      confidence: "high",
      evidence: [{
        sourceFile: rel,
        evidenceType: "next-app-route",
        detail: `App Router handler ${path} methods=${methods.join(",") || "unknown"}`,
      }],
    };
    routes.push({ path, sourceFile: rel, methods, provenance });
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

function routePathFromFile(relPath: string): string | null {
  const marker = "/app/";
  const idx = relPath.indexOf("app/");
  if (idx < 0) return null;
  let rest = relPath.slice(idx + 4);
  rest = rest.replace(/\/route\.(ts|js|tsx|jsx)$/, "");
  if (!rest.startsWith("api/")) return null;
  return `/${rest}`;
}

export function hasNextAppRouterPages(repoRoot: string, config?: DocforceConfig): boolean {
  const scope = resolveScanScope(config);
  const files = walkScopedFiles(repoRoot, scope, "source", (relPath, name) => {
    return /(?:^|\/)app\//.test(relPath.replace(/\\/g, "/")) && /^(page|layout)\.(ts|tsx|js|jsx)$/.test(name);
  });
  return files.length > 0;
}
