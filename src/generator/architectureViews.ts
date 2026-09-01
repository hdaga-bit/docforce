import type { DocforceConfig } from "../config/types.js";
import type { DeviceInfo, InfrastructureInfo, Relationship, SystemModel } from "../model/types.js";
import { buildDocumentationViewModel, infrastructureEntityId, overviewCategoryLabel, viewSpec } from "../view/buildViewModel.js";
import { presentationConfig } from "../view/presentationConfig.js";
import type { ArchitectureViewKind, ComponentViewItem, OverviewCategory, OverviewNode } from "../view/types.js";
import { datastoreNodeId, integrationNodeId } from "../view/ids.js";
import { integrationLabel } from "../view/integrationLabels.js";
import { groupIntegrations, groupedTargetId } from "../view/integrationGroups.js";
import { serviceDisplayLabel } from "../view/serviceLabels.js";
import { escMermaid, insufficientView, MermaidIds } from "./mermaid.js";

const SCHEMA_DATASTORE_TYPES = new Set(["migration-directory", "schema-definition"]);

export function generateSystemOverview(model: SystemModel, config?: DocforceConfig): string {
  const cfg = presentationConfig(config);
  const view = buildDocumentationViewModel(model, cfg);
  const spec = viewSpec(view, "system-overview");
  if (!spec.available) {
    return insufficientView("system-overview", spec.reason ?? "No category evidence.");
  }

  const lines = header(model, "System Overview");
  lines.push("graph TD");
  const ids = new MermaidIds();

  const byCategory = new Map<OverviewCategory, OverviewNode[]>();
  for (const node of view.overviewNodes) {
    const list = byCategory.get(node.category) ?? [];
    list.push(node);
    byCategory.set(node.category, list);
  }

  for (const [category, nodes] of byCategory) {
    lines.push("");
    lines.push(`  subgraph ${escMermaid(overviewCategoryLabel(category))}`);
    for (const node of nodes) {
      const id = ids.id(node.entityId);
      lines.push(`    ${id}${shapeForCategory(category, node.label)}`);
    }
    lines.push("  end");
  }

  const rels = model.relationships.filter((rel) => spec.relationshipIds.includes(rel.id));
  appendEdges(lines, ids, rels);
  lines.push("");
  return lines.join("\n");
}

export function generateSoftwareArchitecture(model: SystemModel, config?: DocforceConfig): string {
  const cfg = presentationConfig(config);
  const view = buildDocumentationViewModel(model, cfg);
  const spec = viewSpec(view, "software-architecture");
  if (!spec.available) {
    return insufficientView("software-architecture", spec.reason ?? "No software component evidence.");
  }

  const included = new Set(
    view.components.filter((c) => c.presentation !== "utility").map((c) => c.id),
  );
  const composeServices = model.infrastructure.filter((item) => item.type === "docker-service");
  const softwareNames = new Set(view.components.map((c) => c.name).concat(view.components.map((c) => c.id)));
  const calledServiceIds = new Set(
    spec.nodeEntityIds.filter((id) => id.startsWith("infra:")),
  );
  const localServices = composeServices.filter((svc) => {
    const id = infrastructureEntityId(svc);
    if (calledServiceIds.has(id)) return true;
    return !model.components.some((c) => c.id === svc.name || c.name === svc.name);
  });

  const lines = header(model, "Software Architecture");
  lines.push("graph TD");
  const ids = new MermaidIds();

  const software = view.components.filter((c) => included.has(c.id));
  if (software.length > 0) {
    lines.push("");
    lines.push("  subgraph Software");
    for (const component of software) {
      const id = ids.id(component.id);
      lines.push(`    ${id}["${escMermaid(component.displayName)}"]`);
    }
    lines.push("  end");
  }

  if (localServices.length > 0) {
    lines.push("");
    lines.push("  subgraph Local Services");
    for (const svc of localServices) {
      const id = ids.id(infrastructureEntityId(svc));
      lines.push(`    ${id}["${escMermaid(serviceDisplayLabel(svc.name, softwareNames))}"]`);
    }
    lines.push("  end");
  }

  const stores = model.datastores.filter((ds) => spec.nodeEntityIds.includes(datastoreNodeId(ds.name)));
  if (stores.length > 0) {
    lines.push("");
    lines.push("  subgraph Storage");
    for (const ds of stores) {
      const id = ids.id(datastoreNodeId(ds.name));
      lines.push(`    ${id}[("${escMermaid(ds.name)}")]`);
    }
    lines.push("  end");
  }

  const calledIntegrationIds = spec.nodeEntityIds.filter((id) => id.startsWith("ext:"));
  const calledNames = model.integrations
    .filter((integ) => calledIntegrationIds.includes(integrationNodeId(integ.name)))
    .map((integ) => integ.name);
  const integrationGroups = groupIntegrations(calledNames);
  if (integrationGroups.length > 0) {
    lines.push("");
    lines.push("  subgraph External");
    for (const group of integrationGroups) {
      if (group.family === "ungrouped") {
        const name = group.members[0]!;
        lines.push(`    ${ids.id(integrationNodeId(name))}(("${escMermaid(integrationLabel(name))}"))`);
      } else {
        lines.push(`    ${ids.id(group.id)}(("${escMermaid(group.label)}"))`);
      }
    }
    lines.push("  end");
  }

  if (view.apiRouteCount > 0) {
    lines.push("");
    lines.push("  subgraph Local API");
    const summary = `${view.apiRouteCount} route${view.apiRouteCount === 1 ? "" : "s"} / ${view.apiGroupCount} group${view.apiGroupCount === 1 ? "" : "s"}`;
    lines.push(`    ${ids.id("api-surface")}["${escMermaid(summary)}"]`);
    lines.push("  end");
  }

  const rels = model.relationships.filter((rel) => spec.relationshipIds.includes(rel.id));
  const mapped = rels.map((rel) => {
    const to = groupedTargetId(rel.to, integrationGroups);
    return to === rel.to ? rel : { ...rel, to };
  });
  const seen = new Set<string>();
  const uniqueRels = mapped.filter((rel) => {
    const key = `${rel.from}:${rel.type}:${rel.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  appendEdges(lines, ids, uniqueRels);

  const apiOwners = new Set(
    view.apiGroups.flatMap((group) =>
      group.routes
        .map((route) => route.relatedComponentId)
        .filter((id): id is string => typeof id === "string" && included.has(id)),
    ),
  );
  for (const owner of apiOwners) {
    const fromId = ids.get(owner);
    const toId = ids.get("api-surface");
    if (fromId && toId) {
      lines.push(`  ${fromId} -- "exposes" --> ${toId}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function generateDeploymentArchitecture(model: SystemModel, config?: DocforceConfig): string {
  const cfg = presentationConfig(config);
  const view = buildDocumentationViewModel(model, cfg);
  const spec = viewSpec(view, "deployment-architecture");
  if (!spec.available) {
    return insufficientView("deployment-architecture", spec.reason ?? "No deployment evidence.");
  }

  const lines = header(model, "Deployment Architecture");
  lines.push("graph TD");
  const ids = new MermaidIds();

  const services = model.infrastructure.filter((i) => i.type === "docker-service" || i.type === "systemd-service");
  const volumes = model.infrastructure.filter((i) => i.type === "docker-volume");
  const networks = model.infrastructure.filter((i) => i.type === "docker-network");
  const fleet = model.infrastructure.filter((i) => i.type === "device-fleet");
  const softwareNames = new Set(model.components.map((c) => c.id).concat(model.components.map((c) => c.name)));

  const mappingRels = model.relationships.filter((rel) =>
    spec.relationshipIds.includes(rel.id) && (rel.type === "deploys" || rel.type === "runs-on"),
  );
  const softwareIds = [...new Set(
    mappingRels
      .map((rel) => rel.from)
      .filter((id) => model.components.some((c) => c.id === id)),
  )];
  if (softwareIds.length > 0) {
    lines.push("");
    lines.push("  subgraph Software");
    for (const id of softwareIds) {
      const label = labelForId(id, model, view.components);
      lines.push(`    ${ids.id(id)}["${escMermaid(label)}"]`);
    }
    lines.push("  end");
  }

  emitInfraSubgraph(lines, ids, "Services", services, (item) =>
    `["${escMermaid(serviceDisplayLabel(item.name, softwareNames))}"]`,
  );
  emitInfraSubgraph(lines, ids, "Named Volumes", volumes, (item) => `[("${escMermaid(item.name)}")]`);
  emitInfraSubgraph(lines, ids, "Networks", networks, (item) => `{{"${escMermaid(item.name)}"}}`);
  emitInfraSubgraph(lines, ids, "Fleet / Deployment Target", fleet, (item) => `["${escMermaid(item.name)}"]`);

  const composeDepends = new Set<string>();
  for (const svc of services) {
    for (const dep of parseDependsOn(svc.detail)) {
      const fromId = ids.get(infrastructureEntityId(svc));
      const target = services.find((s) => s.name === dep);
      const toId = target ? ids.get(infrastructureEntityId(target)) : undefined;
      if (fromId && toId) {
        lines.push(`  ${fromId} -- "depends_on" --> ${toId}`);
        composeDepends.add(`${infrastructureEntityId(svc)}->${infrastructureEntityId(target!)}`);
      }
    }
  }

  const rels = model.relationships.filter((rel) => spec.relationshipIds.includes(rel.id));
  for (const rel of rels) {
    if (rel.type === "depends-on" && composeDepends.has(`${rel.from}->${rel.to}`)) continue;
    const fromKey = resolveDeployNode(rel.from, model, view.components);
    const toKey = resolveDeployNode(rel.to, model, view.components);
    if (!fromKey || !toKey) continue;
    if (!ids.has(fromKey)) {
      const label = labelForId(fromKey, model, view.components);
      lines.push(`  ${ids.id(fromKey)}["${escMermaid(label)}"]`);
    }
    if (!ids.has(toKey)) {
      const label = labelForId(toKey, model, view.components);
      lines.push(`  ${ids.id(toKey)}["${escMermaid(label)}"]`);
    }
    const fromId = ids.get(fromKey);
    const toId = ids.get(toKey);
    if (fromId && toId && fromId !== toId) {
      lines.push(`  ${fromId} -- "${escMermaid(rel.type === "depends-on" ? "depends_on" : rel.type)}" --> ${toId}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function generateDataArchitecture(model: SystemModel, config?: DocforceConfig): string {
  const cfg = presentationConfig(config);
  const view = buildDocumentationViewModel(model, cfg);
  const spec = viewSpec(view, "data-architecture");
  if (!spec.available) {
    return insufficientView("data-architecture", spec.reason ?? "No datastore evidence.");
  }

  const lines = header(model, "Data Architecture");
  lines.push("graph TD");
  const ids = new MermaidIds();

  const stores = model.datastores.filter((ds) => !SCHEMA_DATASTORE_TYPES.has(ds.type));
  lines.push("");
  lines.push("  subgraph Storage");
  for (const ds of stores) {
    const key = datastoreNodeId(ds.name);
    const id = ids.id(key);
    lines.push(`    ${id}[("${escMermaid(ds.name)}")]`);
  }
  lines.push("  end");

  const rels = model.relationships.filter((rel) => spec.relationshipIds.includes(rel.id));
  const softwareIds = new Set<string>();
  for (const rel of rels) {
    softwareIds.add(rel.from);
  }
  if (softwareIds.size > 0) {
    lines.push("");
    lines.push("  subgraph Software");
    for (const id of softwareIds) {
      const label = labelForId(id, model, view.components);
      lines.push(`    ${ids.id(id)}["${escMermaid(label)}"]`);
    }
    lines.push("  end");
  }

  appendEdges(lines, ids, rels);
  lines.push("");
  return lines.join("\n");
}

export function generateDeviceArchitecture(model: SystemModel, config?: DocforceConfig): string {
  const cfg = presentationConfig(config);
  const view = buildDocumentationViewModel(model, cfg);
  const spec = viewSpec(view, "device-architecture");
  if (!spec.available) {
    return insufficientView("device-architecture", spec.reason ?? "No device evidence.");
  }

  const lines = header(model, "Device Architecture");
  lines.push("graph TD");
  const ids = new MermaidIds();

  const devices = (model.devices ?? []).filter((device) => device.kind !== "device-service");
  const byKind = new Map<string, DeviceInfo[]>();
  for (const device of devices) {
    const list = byKind.get(device.kind) ?? [];
    list.push(device);
    byKind.set(device.kind, list);
  }

  for (const [kind, group] of byKind) {
    lines.push("");
    lines.push(`  subgraph ${escMermaid(kindLabel(kind))}`);
    for (const device of group) {
      const nodeId = ids.id(device.id);
      lines.push(`    ${nodeId}["${escMermaid(device.name)}"]`);
    }
    lines.push("  end");
  }

  const deviceIds = new Set(devices.map((device) => device.id));
  const composeNames = new Set(
    model.infrastructure.filter((item) => item.type === "docker-service").map((item) => item.name),
  );
  const rels = model.relationships.filter((rel) => {
    if (!spec.relationshipIds.includes(rel.id)) return false;
    if (rel.from.startsWith("dsvc:") || rel.to.startsWith("dsvc:")) return false;
    if (rel.type === "runs-on" && composeNames.has(rel.from)) return false;
    return deviceIds.has(rel.to) || deviceIds.has(rel.from);
  });
  const software = new Set(
    rels
      .filter((rel) => rel.type === "attached-to" || rel.type === "communicates-over")
      .map((rel) => rel.from)
      .filter((id) => model.components.some((c) => c.id === id)),
  );
  if (software.size > 0) {
    lines.push("");
    lines.push("  subgraph Software");
    for (const id of software) {
      const label = labelForId(id, model, view.components);
      lines.push(`    ${ids.id(id)}["${escMermaid(label)}"]`);
    }
    lines.push("  end");
  }

  appendEdges(lines, ids, rels);
  lines.push("");
  return lines.join("\n");
}

function header(model: SystemModel, title: string): string[] {
  return [
    `%% ${model.product.name} ${title}`,
    "%% Generated by DocForce",
    "%% Edges are evidence-backed relationships",
    "",
  ];
}

function shapeForCategory(category: OverviewCategory, label: string): string {
  const safe = escMermaid(label);
  switch (category) {
    case "application-software":
    case "local-services":
      return `["${safe}"]`;
    case "data-storage":
      return `[("${safe}")]`;
    case "external-integrations":
      return `(("${safe}"))`;
    case "device-peripherals":
      return `["${safe}"]`;
    case "infrastructure-deployment":
      return `["${safe}"]`;
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

function emitInfraSubgraph(
  lines: string[],
  ids: MermaidIds,
  title: string,
  items: readonly InfrastructureInfo[],
  shape: (item: InfrastructureInfo) => string,
): void {
  if (items.length === 0) return;
  lines.push("");
  lines.push(`  subgraph ${title}`);
  for (const item of items) {
    lines.push(`    ${ids.id(infrastructureEntityId(item))}${shape(item)}`);
  }
  lines.push("  end");
}

function parseDependsOn(detail?: string): string[] {
  if (!detail) return [];
  const match = detail.match(/depends_on ([^;]+)/);
  if (!match) return [];
  return match[1]!.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

function resolveDeployNode(
  id: string,
  model: SystemModel,
  components: readonly ComponentViewItem[],
): string | undefined {
  if (id.startsWith("infra:")) {
    const item = model.infrastructure.find((i) => infrastructureEntityId(i) === id);
    return item ? infrastructureEntityId(item) : id;
  }
  if (components.some((c) => c.id === id) || model.components.some((c) => c.id === id)) {
    return id;
  }
  const byInfraId = model.infrastructure.find((item) => infrastructureEntityId(item) === id);
  if (byInfraId) return infrastructureEntityId(byInfraId);
  const device = (model.devices ?? []).find((d) => d.id === id);
  if (device) {
    const fleet = model.infrastructure.find((item) => item.type === "device-fleet" && item.name === device.name);
    if (fleet) return infrastructureEntityId(fleet);
    return id;
  }
  return undefined;
}

function labelForId(
  id: string,
  model: SystemModel,
  components: readonly ComponentViewItem[],
): string {
  const component = components.find((c) => c.id === id) ?? model.components.find((c) => c.id === id);
  if (component) {
    return "displayName" in component ? String(component.displayName ?? component.name) : component.name;
  }
  const device = (model.devices ?? []).find((d) => d.id === id);
  if (device) return device.name;
  if (id.startsWith("ext:")) {
    const integ = model.integrations.find((i) => integrationNodeId(i.name) === id);
    return integ?.name ?? id.slice(4);
  }
  if (id.startsWith("store:")) {
    const ds = model.datastores.find((d) => datastoreNodeId(d.name) === id);
    return ds?.name ?? id.slice(6);
  }
  if (id.startsWith("infra:")) {
    const name = id.slice(6);
    const softwareNames = new Set(model.components.map((c) => c.id).concat(model.components.map((c) => c.name)));
    return serviceDisplayLabel(name, softwareNames);
  }
  return id;
}

function appendEdges(lines: string[], ids: MermaidIds, rels: readonly Relationship[]): void {
  lines.push("");
  for (const rel of rels) {
    const fromId = ids.get(rel.from);
    const toId = ids.get(rel.to);
    if (!fromId || !toId) continue;
    const label = formatEdgeLabel(rel);
    if (label) {
      lines.push(`  ${fromId} -- "${escMermaid(label)}" --> ${toId}`);
    } else {
      lines.push(`  ${fromId} --> ${toId}`);
    }
  }
}

function formatEdgeLabel(rel: Relationship): string | null {
  switch (rel.type) {
    case "imports": return null;
    case "calls-api": return "calls";
    case "persists-to": return "persists";
    case "receives-from": return "receives";
    case "spawns": return "spawns";
    case "invokes": return "invokes";
    case "depends-on": return "depends-on";
    case "reads-from": return "reads";
    case "writes-to": return "writes";
    case "publishes-to": return "publishes";
    case "deploys": return "deploys";
    case "configures": return "configures";
    case "runs-on": return "runs-on";
    case "attached-to": return "attached-to";
    case "communicates-over": return "over";
    case "mounts": return "mounts";
    default: {
      const _exhaustive: never = rel.type;
      return _exhaustive;
    }
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "device": return "Device";
    case "device-service": return "Device Services";
    case "sensor": return "Sensors";
    case "peripheral": return "Peripherals";
    case "communication-interface": return "Communication Interfaces";
    default: return kind;
  }
}

export function generateArchitectureView(
  kind: ArchitectureViewKind,
  model: SystemModel,
  config?: DocforceConfig,
): string {
  switch (kind) {
    case "system-overview":
      return generateSystemOverview(model, config);
    case "software-architecture":
      return generateSoftwareArchitecture(model, config);
    case "deployment-architecture":
      return generateDeploymentArchitecture(model, config);
    case "data-architecture":
      return generateDataArchitecture(model, config);
    case "device-architecture":
      return generateDeviceArchitecture(model, config);
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
