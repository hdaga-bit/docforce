import type { ApiRouteInfo, ComponentInfo } from "../model/types.js";
import type { ApiRouteGroup, ApiRouteViewItem } from "./types.js";
import { routeBelongsToComponent } from "./classifyComponent.js";

/**
 * Group App Router routes by the first path segment after `/api/`.
 * `/api/voice/stt` → group `voice`. `/api/health` → group `health`.
 * Groups are repository path segments, not invented conceptual categories.
 */
export function apiRouteGroupName(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  if (parts[0] === "api") {
    return parts[1] ?? "root";
  }
  return parts[0] ?? "root";
}

export function relatedComponentId(
  sourceFile: string,
  components: readonly ComponentInfo[],
): string | undefined {
  const matches = components.filter((component) =>
    routeBelongsToComponent(sourceFile, component.path),
  );
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => b.path.length - a.path.length);
  return matches[0]!.id;
}

export function groupApiRoutes(
  routes: readonly ApiRouteInfo[],
  components: readonly ComponentInfo[],
): ApiRouteGroup[] {
  const grouped = new Map<string, ApiRouteViewItem[]>();

  const sorted = [...routes].sort((a, b) => a.path.localeCompare(b.path));
  for (const route of sorted) {
    const item: ApiRouteViewItem = {
      path: route.path,
      methods: route.methods,
      sourceFile: route.sourceFile,
      relatedComponentId: relatedComponentId(route.sourceFile, components),
      evidence: route.provenance.evidence,
    };
    const group = apiRouteGroupName(route.path);
    const list = grouped.get(group) ?? [];
    list.push(item);
    grouped.set(group, list);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, groupRoutes]) => ({ group, routes: groupRoutes }));
}
