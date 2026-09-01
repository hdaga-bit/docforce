import type { DocforceConfig } from "../config/types.js";
import type { InfrastructureInfo, Relationship, SystemModel } from "../model/types.js";
import { classifyComponents } from "./classifyComponent.js";
import { classifyTechnologies } from "./classifyTechnology.js";
import { assessDocumentationCoverage } from "./coverage.js";
import { groupApiRoutes } from "./groupApiRoutes.js";
import { datastoreNodeId, integrationNodeId } from "./ids.js";
import { integrationLabel } from "./integrationLabels.js";
import { groupIntegrations, groupedTargetId } from "./integrationGroups.js";
import { serviceDisplayLabel } from "./serviceLabels.js";
import type {
  ArchitectureViewKind,
  ArchitectureViewSpec,
  ComponentViewItem,
  DocumentationViewModel,
  OverviewCategory,
  OverviewNode,
} from "./types.js";

const OVERVIEW_SOFTWARE_LIMIT = 8;
const OVERVIEW_INTEGRATION_LIMIT = 12;
const OVERVIEW_DEVICE_LIMIT = 6;

const SCHEMA_DATASTORE_TYPES = new Set(["migration-directory", "schema-definition"]);

export function buildDocumentationViewModel(
  model: SystemModel,
  config: DocforceConfig,
): DocumentationViewModel {
  const technologies = classifyTechnologies(model, config);
  const components = classifyComponents(model, config);
  const apiGroups = groupApiRoutes(model.apiRoutes ?? [], model.components);
  const overviewNodes = selectOverviewNodes(model, components);
  const views = buildViewSpecs(model, components, overviewNodes);
  const coverage = assessDocumentationCoverage(model);

  return {
    technologies,
    components,
    apiGroups,
    apiRouteCount: (model.apiRoutes ?? []).length,
    apiGroupCount: apiGroups.length,
    overviewNodes,
    views,
    coverage,
  };
}

export function viewSpec(
  viewModel: DocumentationViewModel,
  kind: ArchitectureViewKind,
): ArchitectureViewSpec {
  return viewModel.views.find((view) => view.kind === kind) ?? {
    kind,
    available: false,
    reason: "View was not produced",
    nodeEntityIds: [],
    relationshipIds: [],
  };
}

function selectOverviewNodes(
  model: SystemModel,
  components: readonly ComponentViewItem[],
): OverviewNode[] {
  const nodes: OverviewNode[] = [];
  const used = new Set<string>();
  const composeServices = model.infrastructure.filter((item) => item.type === "docker-service");
  const softwareNames = new Set(components.map((c) => c.name).concat(components.map((c) => c.id)));

  const software = components
    .filter((component) => {
      if (component.presentation === "utility") return false;
      return component.presentation === "primary" || component.presentation === "supporting" || component.presentation === "neutral";
    })
    .sort(compareComponentsForOverview)
    .slice(0, OVERVIEW_SOFTWARE_LIMIT);

  for (const component of software) {
    nodes.push({
      entityId: component.id,
      label: component.displayName,
      category: "application-software",
    });
    used.add(component.id);
  }

  for (const service of composeServices) {
    const id = `infra:${service.name}`;
    nodes.push({
      entityId: id,
      label: serviceDisplayLabel(service.name, softwareNames),
      category: "local-services",
    });
    used.add(id);
  }

  const systemd = model.infrastructure.filter((item) => item.type === "systemd-service");
  for (const service of systemd) {
    const id = `infra:${service.name}`;
    if (used.has(id)) continue;
    nodes.push({
      entityId: id,
      label: service.name,
      category: "local-services",
    });
    used.add(id);
  }

  for (const ds of model.datastores) {
    if (SCHEMA_DATASTORE_TYPES.has(ds.type)) continue;
    nodes.push({
      entityId: datastoreNodeId(ds.name),
      label: ds.name,
      category: "data-storage",
    });
  }

  const integrations = model.integrations.filter((integ) => integ.type !== "system");
  const groups = groupIntegrations(integrations.map((integ) => integ.name)).slice(0, OVERVIEW_INTEGRATION_LIMIT);
  for (const group of groups) {
    if (group.family === "ungrouped") {
      const name = group.members[0]!;
      nodes.push({
        entityId: integrationNodeId(name),
        label: integrationLabel(name),
        category: "external-integrations",
      });
    } else {
      nodes.push({
        entityId: group.id,
        label: group.label,
        category: "external-integrations",
      });
    }
  }

  const composeServiceNames = new Set(composeServices.map((service) => service.name));
  const fleetNames = new Set(
    model.infrastructure.filter((item) => item.type === "device-fleet").map((item) => item.name),
  );
  const devices = [...(model.devices ?? [])]
    .filter((device) => !(device.kind === "device-service" && composeServiceNames.has(device.name)))
    .filter((device) => !(device.kind === "device" && fleetNames.has(device.name)))
    .sort((a, b) => devicePriority(a.kind) - devicePriority(b.kind) || a.name.localeCompare(b.name))
    .slice(0, OVERVIEW_DEVICE_LIMIT);
  for (const device of devices) {
    nodes.push({
      entityId: device.id,
      label: device.name,
      category: "device-peripherals",
    });
  }

  const infra = model.infrastructure.filter((item) =>
    item.type === "device-fleet" || item.type === "docker-network",
  );
  for (const item of infra) {
    const id = `infra:${item.name}`;
    if (used.has(id)) continue;
    nodes.push({
      entityId: id,
      label: item.name,
      category: "infrastructure-deployment",
    });
    used.add(id);
  }

  return nodes;
}

function compareComponentsForOverview(a: ComponentViewItem, b: ComponentViewItem): number {
  const rank = (item: ComponentViewItem): number => {
    if (item.presentation === "primary") return 0;
    if (item.presentation === "supporting") return 1;
    return 2;
  };
  return rank(a) - rank(b) || b.degree - a.degree || a.name.localeCompare(b.name);
}

function devicePriority(kind: string): number {
  switch (kind) {
    case "peripheral": return 0;
    case "sensor": return 1;
    case "communication-interface": return 2;
    case "device": return 3;
    case "device-service": return 4;
    default: return 5;
  }
}

function buildViewSpecs(
  model: SystemModel,
  components: readonly ComponentViewItem[],
  overviewNodes: readonly OverviewNode[],
): ArchitectureViewSpec[] {
  return [
    systemOverviewSpec(model, overviewNodes),
    softwareArchitectureSpec(model, components),
    deploymentArchitectureSpec(model),
    dataArchitectureSpec(model),
    deviceArchitectureSpec(model),
  ];
}

function systemOverviewSpec(
  model: SystemModel,
  overviewNodes: readonly OverviewNode[],
): ArchitectureViewSpec {
  const categories = new Set(overviewNodes.map((node) => node.category));
  const hasStructure = categories.size >= 1 && overviewNodes.length > 0;
  const relationshipIds = overviewRelationships(model, overviewNodes).map((rel) => rel.id);
  return {
    kind: "system-overview",
    available: hasStructure,
    reason: hasStructure
      ? undefined
      : "Insufficient evidence to group the system into architecture categories.",
    nodeEntityIds: overviewNodes.map((node) => node.entityId),
    relationshipIds,
  };
}

function softwareArchitectureSpec(
  model: SystemModel,
  components: readonly ComponentViewItem[],
): ArchitectureViewSpec {
  const included = new Set(
    components
      .filter((component) => component.presentation !== "utility")
      .map((component) => component.id),
  );

  const rels = model.relationships.filter((rel) => {
    if (rel.classification === "unknown") return false;
    if (rel.type === "imports" || rel.type === "invokes" || rel.type === "depends-on" || rel.type === "spawns") {
      return included.has(rel.from) && included.has(rel.to);
    }
    if (rel.type === "calls-api" && included.has(rel.from) && rel.to.startsWith("infra:")) return true;
    if (rel.type === "calls-api" && included.has(rel.from) && rel.to.startsWith("ext:")) return true;
    if (
      (rel.type === "persists-to" || rel.type === "reads-from" || rel.type === "writes-to")
      && included.has(rel.from)
      && rel.to.startsWith("store:")
    ) {
      return true;
    }
    return false;
  });

  const extraTargets = rels
    .map((rel) => rel.to)
    .filter((to) => to.startsWith("infra:") || to.startsWith("store:") || to.startsWith("ext:"));

  const nodeIds = [
    ...included,
    ...new Set(extraTargets),
    ...(model.apiRoutes ?? []).length > 0 ? ["api-surface"] : [],
  ];

  const available = included.size > 0;
  return {
    kind: "software-architecture",
    available,
    reason: available
      ? undefined
      : "Insufficient software-component or local-service evidence for a software architecture view.",
    nodeEntityIds: nodeIds,
    relationshipIds: rels.map((rel) => rel.id),
  };
}

function deploymentArchitectureSpec(model: SystemModel): ArchitectureViewSpec {
  const deployTypes = new Set([
    "docker-service",
    "docker-volume",
    "docker-network",
    "device-fleet",
    "systemd-service",
    "systemd-dependency",
  ]);
  const items = model.infrastructure.filter((item) => deployTypes.has(item.type));
  const runnable = items.filter((item) =>
    item.type === "docker-service" || item.type === "systemd-service" || item.type === "device-fleet",
  );
  const rels = model.relationships.filter((rel) =>
    rel.type === "depends-on" || rel.type === "runs-on" || rel.type === "deploys" || rel.type === "configures" || rel.type === "mounts",
  );
  const available = runnable.length > 0;
  return {
    kind: "deployment-architecture",
    available,
    reason: available
      ? undefined
      : "No compose service, systemd service, or fleet target was discovered.",
    nodeEntityIds: items.map((item) => infrastructureEntityId(item)),
    relationshipIds: rels.map((rel) => rel.id),
  };
}

function dataArchitectureSpec(model: SystemModel): ArchitectureViewSpec {
  const stores = model.datastores.filter((ds) => !SCHEMA_DATASTORE_TYPES.has(ds.type));
  const rels = model.relationships.filter((rel) =>
    rel.type === "persists-to" || rel.type === "reads-from" || rel.type === "writes-to",
  );
  const available = stores.length > 0;
  return {
    kind: "data-architecture",
    available,
    reason: available ? undefined : "No datastore evidence was discovered.",
    nodeEntityIds: stores.map((ds) => datastoreNodeId(ds.name)),
    relationshipIds: rels.map((rel) => rel.id),
  };
}

function deviceArchitectureSpec(model: SystemModel): ArchitectureViewSpec {
  const devices = (model.devices ?? []).filter((device) => device.kind !== "device-service");
  const rels = model.relationships.filter((rel) =>
    (rel.type === "attached-to" || rel.type === "communicates-over" || rel.type === "runs-on")
    && !rel.from.startsWith("dsvc:")
    && !rel.to.startsWith("dsvc:"),
  );
  const available = devices.length > 0;
  const relatedSoftware = rels.map((rel) => rel.from);
  return {
    kind: "device-architecture",
    available,
    reason: available
      ? undefined
      : "No device, peripheral, or communication-interface evidence was discovered.",
    nodeEntityIds: [...new Set([...devices.map((device) => device.id), ...relatedSoftware])],
    relationshipIds: rels.map((rel) => rel.id),
  };
}

function overviewRelationships(
  model: SystemModel,
  overviewNodes: readonly OverviewNode[],
): Relationship[] {
  const ids = new Set(overviewNodes.map((node) => node.entityId));
  const groups = groupIntegrations(
    model.integrations.filter((integ) => integ.type !== "system").map((integ) => integ.name),
  );
  const allowed = new Set([
    "calls-api",
    "persists-to",
    "runs-on",
    "attached-to",
    "communicates-over",
    "depends-on",
    "reads-from",
    "writes-to",
    "deploys",
    "mounts",
  ]);
  const seen = new Set<string>();
  const result: Relationship[] = [];
  for (const rel of model.relationships) {
    if (!allowed.has(rel.type)) continue;
    if (rel.classification === "unknown") continue;
    const to = groupedTargetId(rel.to, groups);
    const from = groupedTargetId(rel.from, groups);
    if (!ids.has(from) || !ids.has(to)) continue;
    const key = `${from}:${rel.type}:${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(from === rel.from && to === rel.to ? rel : { ...rel, from, to });
  }
  return result;
}

export function infrastructureEntityId(item: InfrastructureInfo): string {
  return `infra:${item.name}`;
}

export function overviewCategoryLabel(category: OverviewCategory): string {
  switch (category) {
    case "application-software": return "Application / Software";
    case "local-services": return "Local Services";
    case "data-storage": return "Data / Storage";
    case "external-integrations": return "External Integrations";
    case "device-peripherals": return "Device / Peripherals";
    case "infrastructure-deployment": return "Infrastructure / Deployment";
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}
