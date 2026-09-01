import type { InfrastructureInfo } from "../model/types.js";

export interface AggregatedImage {
  readonly name: string;
  readonly count: number;
  readonly files: readonly string[];
  readonly detail: string;
  readonly items: readonly InfrastructureInfo[];
}

export function aggregateContainerImages(
  items: readonly InfrastructureInfo[],
): AggregatedImage[] {
  const images = items.filter((item) => item.type === "container-image");
  const groups = new Map<string, InfrastructureInfo[]>();
  for (const item of images) {
    const list = groups.get(item.name) ?? [];
    list.push(item);
    groups.set(item.name, list);
  }
  return [...groups.entries()].map(([name, group]) => {
    const files = [...new Set(group.map((item) => item.provenance.evidence[0]?.sourceFile).filter(Boolean))] as string[];
    const count = group.length;
    const detail = count === 1
      ? (group[0]!.detail ?? `Base image ${name}`)
      : `Base image used by ${count} Dockerfiles`;
    return { name, count, files, detail, items: group };
  });
}
