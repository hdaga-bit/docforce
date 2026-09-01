import type { ComponentInfo, SystemModel } from "../model/types.js";

function belongsToComponent(sourceFile: string, componentPath: string): boolean {
  const normalizedPath = componentPath.replace(/\/$/, "");
  return sourceFile === normalizedPath || sourceFile.startsWith(`${normalizedPath}/`);
}

export function componentResponsibilitySummary(
  component: ComponentInfo,
  model: SystemModel,
): string | undefined {
  const clauses: string[] = [];

  const apiCount = (model.apiRoutes ?? []).filter((route) =>
    belongsToComponent(route.sourceFile, component.path),
  ).length;
  if (apiCount > 0) {
    clauses.push(`Hosts ${apiCount} App Router API route${apiCount === 1 ? "" : "s"}.`);
  }

  const matchingService = model.infrastructure.some(
    (item) => item.type === "docker-service" && (item.name === component.id || item.name === component.name),
  );
  const fleet = model.infrastructure.some((item) => item.type === "device-fleet")
    || (model.devices ?? []).some((device) => device.kind === "device");
  if (matchingService && fleet) {
    clauses.push("Runs as a Compose service on the device fleet.");
  } else if (matchingService) {
    clauses.push("Runs as a Compose service.");
  }

  const localCalls = model.relationships.filter(
    (rel) => rel.from === component.id && rel.type === "calls-api" && rel.to.startsWith("infra:"),
  ).length;
  if (localCalls > 0) {
    clauses.push(`Calls ${localCalls} local service${localCalls === 1 ? "" : "s"} over HTTP.`);
  }

  const storeRels = model.relationships.filter(
    (rel) => rel.from === component.id && rel.to.startsWith("store:") && (
      rel.type === "reads-from" || rel.type === "writes-to" || rel.type === "persists-to"
    ),
  );
  if (storeRels.length > 0) {
    const names = [...new Set(storeRels.map((rel) => rel.to.replace(/^store:/, "")))];
    clauses.push(`Accesses ${names.join(", ")}.`);
  }

  const deviceRels = model.relationships.filter(
    (rel) => rel.from === component.id && (rel.type === "attached-to" || rel.type === "communicates-over"),
  ).length;
  if (deviceRels > 0) {
    clauses.push(`Uses ${deviceRels} documented device interface${deviceRels === 1 ? "" : "s"}.`);
  }

  const extCalls = model.relationships.filter(
    (rel) => rel.from === component.id && rel.type === "calls-api" && rel.to.startsWith("ext:"),
  ).length;
  if (extCalls > 0) {
    clauses.push(`Calls ${extCalls} external HTTP service${extCalls === 1 ? "" : "s"}.`);
  }

  if (clauses.length === 0) return undefined;
  return clauses.slice(0, 3).join(" ");
}
