import type { SystemModel } from "../model/types.js";
import { assessDocumentationCoverage } from "../view/coverage.js";
import type { CoverageStatus } from "../view/types.js";

export interface RepositorySummary {
  readonly product: string;
  readonly detected: readonly string[];
  readonly components: number;
  readonly relationships: number;
  readonly apiRoutes: number;
  readonly datastores: number;
  readonly integrations: number;
  readonly devices: number;
  readonly deployment: string;
  readonly coverage: readonly { readonly label: string; readonly status: string }[];
}

export function buildRepositorySummary(
  model: SystemModel,
  detected: readonly string[],
): RepositorySummary {
  const compose = model.infrastructure.filter((i) => i.type === "docker-service");
  const fleet = model.infrastructure.find((i) => i.type === "device-fleet");
  const systemd = model.infrastructure.filter((i) => i.type === "systemd-service");
  let deployment = "none discovered";
  if (fleet) deployment = `fleet (${fleet.name})`;
  else if (compose.length > 0) deployment = `${compose.length} Compose service${compose.length === 1 ? "" : "s"}`;
  else if (systemd.length > 0) deployment = `${systemd.length} systemd service${systemd.length === 1 ? "" : "s"}`;

  const coverage = [
    ...assessDocumentationCoverage(model)
      .filter((area) => area.area !== "physical hardware")
      .map((area) => ({ label: coverageLabel(area.area), status: coverageStatus(area.status) })),
    dataCoverage(model),
  ];

  const languages = unique([
    ...detected,
    ...model.languages.map((l) => l.name),
    ...model.runtime.map((r) => r.name),
  ]);

  return {
    product: model.product.name,
    detected: languages,
    components: model.components.length,
    relationships: model.relationships.length,
    apiRoutes: (model.apiRoutes ?? []).length,
    datastores: model.datastores.length,
    integrations: model.integrations.filter((i) => i.type !== "system").length,
    devices: (model.devices ?? []).filter((d) => d.kind !== "device-service").length,
    deployment,
    coverage,
  };
}

export function formatRepositorySummary(summary: RepositorySummary): string {
  const lines = [
    `Repository:`,
    summary.product,
    "",
    "Detected:",
    summary.detected.length > 0 ? summary.detected.join("\n") : "No stack hints",
    "",
    "Architecture:",
    `${summary.components} components`,
    `${summary.relationships} relationships`,
    `${summary.apiRoutes} API routes`,
    `${summary.datastores} datastores`,
    `${summary.integrations} integrations`,
    `Deployment: ${summary.deployment}`,
    `${summary.devices} device/interface${summary.devices === 1 ? "" : "s"}`,
    "",
    "Coverage:",
  ];
  const width = Math.max(...summary.coverage.map((c) => c.label.length), 10);
  for (const area of summary.coverage) {
    lines.push(`${area.label.padEnd(width, " ")}  ${area.status}`);
  }
  return lines.join("\n");
}

function dataCoverage(model: SystemModel): { label: string; status: string } {
  const stores = model.datastores.filter((d) => d.type !== "migration-directory" && d.type !== "schema-definition");
  if (stores.length === 0) return { label: "Data", status: "UNAVAILABLE" };
  const linked = model.relationships.some((rel) => rel.to.startsWith("store:"));
  return { label: "Data", status: linked ? "DISCOVERED" : "PARTIAL" };
}

function coverageLabel(area: string): string {
  switch (area) {
    case "software structure": return "Software";
    case "API surface": return "API";
    case "deployment": return "Deployment";
    case "device interfaces": return "Device";
    default: return area;
  }
}

function coverageStatus(status: CoverageStatus): string {
  switch (status) {
    case "discovered": return "DISCOVERED";
    case "partially represented": return "PARTIAL";
    case "unavailable": return "UNAVAILABLE";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
