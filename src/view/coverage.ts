import type { SystemModel } from "../model/types.js";
import type { CoverageArea, CoverageStatus } from "./types.js";

export function assessDocumentationCoverage(model: SystemModel): CoverageArea[] {
  return [
    softwareCoverage(model),
    apiCoverage(model),
    deploymentCoverage(model),
    deviceCoverage(model),
    physicalHardwareCoverage(model),
  ];
}

function softwareCoverage(model: SystemModel): CoverageArea {
  const components = model.components.length;
  const relationships = model.relationships.length;
  if (components > 0 && relationships > 0) {
    return area(
      "software structure",
      "discovered",
      `${components} components and ${relationships} relationships were discovered from repository evidence.`,
    );
  }
  if (components > 0) {
    return area(
      "software structure",
      "partially represented",
      `${components} components were discovered but no internal relationships were established.`,
    );
  }
  return area(
    "software structure",
    "unavailable",
    "No software components were discovered from repository evidence.",
  );
}

function apiCoverage(model: SystemModel): CoverageArea {
  const routes = (model.apiRoutes ?? []).length;
  if (routes > 0) {
    return area(
      "API surface",
      "discovered",
      `${routes} local API routes were detected from App Router metadata.`,
    );
  }
  return area(
    "API surface",
    "unavailable",
    "No App Router API routes were detected.",
  );
}

function deploymentCoverage(model: SystemModel): CoverageArea {
  const services = model.infrastructure.filter((i) =>
    i.type === "docker-service" || i.type === "systemd-service",
  );
  const fleet = model.infrastructure.filter((i) => i.type === "device-fleet");
  const secondary = model.infrastructure.filter((i) =>
    i.type === "container-image" || i.type === "exposed-port",
  );

  if (services.length > 0 || fleet.length > 0) {
    const parts: string[] = [];
    if (services.length > 0) parts.push(`${services.length} service(s)`);
    if (fleet.length > 0) parts.push(`${fleet.length} fleet target(s)`);
    return area(
      "deployment",
      "discovered",
      `${parts.join(" and ")} were discovered from repository evidence.`,
    );
  }
  if (secondary.length > 0) {
    return area(
      "deployment",
      "partially represented",
      "Container image or port evidence exists, but no compose/systemd/fleet topology was established.",
    );
  }
  return area(
    "deployment",
    "unavailable",
    "No deployment topology was established from repository evidence.",
  );
}

function deviceCoverage(model: SystemModel): CoverageArea {
  const devices = model.devices ?? [];
  if (devices.length === 0) {
    return area(
      "device interfaces",
      "unavailable",
      "No device, peripheral, or communication-interface evidence was discovered.",
    );
  }
  const interfaceLike = devices.filter((d) =>
    d.kind === "communication-interface" || d.kind === "peripheral" || d.kind === "sensor",
  );
  if (interfaceLike.length > 0) {
    return area(
      "device interfaces",
      "discovered",
      `${interfaceLike.length} peripheral/sensor/interface entit${interfaceLike.length === 1 ? "y" : "ies"} were discovered. Physical hardware state is not observed.`,
    );
  }
  return area(
    "device interfaces",
    "partially represented",
    "Device or device-service evidence exists, but no peripheral, sensor, or communication-interface entities were established.",
  );
}

function physicalHardwareCoverage(model: SystemModel): CoverageArea {
  const sensors = (model.devices ?? []).filter((d) => d.kind === "sensor");
  if (sensors.length > 0) {
    return area(
      "physical hardware",
      "partially represented",
      "Sensor entities were inferred from repository evidence. Live hardware state is unavailable.",
    );
  }
  return area(
    "physical hardware",
    "unavailable",
    "Physical hardware is not established from repository evidence.",
  );
}

function area(name: string, status: CoverageStatus, notes: string): CoverageArea {
  return { area: name, status, notes };
}
