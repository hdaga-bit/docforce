import type { DocforceConfig } from "../config/types.js";
import type { Relationship, SystemModel } from "../model/types.js";
import { buildDocumentationViewModel, overviewCategoryLabel, viewSpec } from "../view/buildViewModel.js";
import { presentationConfig } from "../view/presentationConfig.js";
import { componentResponsibilitySummary } from "../view/componentSummary.js";
import { classifyEnvVar, envAreas, parseEnvNamesFromDetail, type EnvArea } from "../view/envSummary.js";
import { aggregateContainerImages } from "../view/infraPresentation.js";
import { integrationLabel } from "../view/integrationLabels.js";
import { groupIntegrations } from "../view/integrationGroups.js";
import { serviceDisplayLabel } from "../view/serviceLabels.js";
import { datastoreNodeId } from "../view/ids.js";
import type { ComponentViewItem, DocumentationViewModel } from "../view/types.js";
import {
  generateDataArchitecture,
  generateDeploymentArchitecture,
  generateDeviceArchitecture,
  generateSoftwareArchitecture,
  generateSystemOverview,
} from "../generator/architectureViews.js";
import {
  DEFAULT_COVERAGE_NOTE,
  DEFAULT_DOCUMENT_TITLE,
  DEFAULT_EVIDENCE_STATEMENT,
  resolvePublicationConfig,
} from "./config.js";
import {
  figureCaption,
  type PublicationBlock,
  type PublicationDocument,
  type PublicationFigureKind,
  type PublicationInfoRow,
  type PublicationSection,
  type PublicationSectionId,
} from "./types.js";

export function buildPublicationDocument(
  model: SystemModel,
  config: DocforceConfig,
): PublicationDocument {
  const publication = resolvePublicationConfig(config.publication);
  const cfg = presentationConfig(config);
  const view = buildDocumentationViewModel(model, cfg);
  const figures = new FigureCounter();

  const organizationName = publication.organization.name;
  const documentTitle = publication.document.title || DEFAULT_DOCUMENT_TITLE;
  const evidenceStatement = DEFAULT_EVIDENCE_STATEMENT;

  const metadata = {
    productName: model.product.name,
    productType: model.product.type,
    organizationName,
    documentTitle,
    classification: publication.document.classification,
    status: publication.document.status,
    evidenceStatement,
    coverageNote: DEFAULT_COVERAGE_NOTE,
    includeOperationalProvenance: publication.includeOperationalProvenance,
  };

  const cover = {
    organizationName,
    logoPath: publication.organization.logo,
    productName: model.product.name,
    documentTitle,
    classification: publication.document.classification || undefined,
    status: publication.document.status || undefined,
    evidenceStatement,
  };

  const information: PublicationInfoRow[] = [
    { label: "Product", value: model.product.name },
    { label: "Document Type", value: documentTitle },
    { label: "Organization", value: organizationName || "—" },
    { label: "Classification", value: publication.document.classification || "—" },
    { label: "Status", value: publication.document.status || "—" },
    { label: "Evidence Source", value: "Validated repository System Model" },
    { label: "Documentation Coverage Note", value: DEFAULT_COVERAGE_NOTE },
  ];
  if (publication.includeOperationalProvenance) {
    information.push(
      { label: "Git revision", value: model.metadata.git.commitSha ?? "—" },
      { label: "Git branch", value: model.metadata.git.branch ?? "—" },
      { label: "Generated at", value: model.metadata.generatedAt },
      { label: "DocForce version", value: model.metadata.docforceVersion },
    );
  }

  const sections: PublicationSection[] = [];
  pushExecutive(sections, model, view);
  pushContext(sections, model, view);
  pushOverview(sections, model, config, view, figures);
  pushSoftware(sections, model, config, view, figures);
  pushTechnology(sections, model, view);
  pushApi(sections, view);
  pushData(sections, model, config, figures);
  pushIntegrations(sections, model);
  pushDevices(sections, model, config, figures);
  pushDeployment(sections, model, config, figures);
  pushRuntime(sections, model);
  pushCoverage(sections, view);
  pushUnknowns(sections, model);
  pushAppendices(sections, model, view);

  return { metadata, cover, information, sections };
}

class FigureCounter {
  private n = 0;
  next(kind: PublicationFigureKind, mermaidSource: string): PublicationBlock {
    this.n += 1;
    return {
      kind: "figure",
      figureKind: kind,
      number: this.n,
      caption: figureCaption(kind, this.n),
      mermaidSource,
    };
  }
}

function section(
  id: PublicationSectionId,
  title: string,
  blocks: PublicationBlock[],
  appendix = false,
): PublicationSection {
  return { id, title, level: 1, appendix, blocks };
}

function para(text: string): PublicationBlock {
  return { kind: "paragraph", text };
}

function bullets(items: readonly string[]): PublicationBlock {
  return { kind: "bullet-list", items };
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): PublicationBlock {
  return { kind: "table", headers, rows };
}

function mermaidUsable(source: string): boolean {
  return /(?:^|\n)\s*graph\s/i.test(source) && !source.includes("View unavailable:");
}

function requireFigure(
  figures: FigureCounter,
  kind: PublicationFigureKind,
  source: string,
): PublicationBlock {
  if (!mermaidUsable(source)) {
    throw new Error(
      `Publication cannot render ${kind}: Mermaid source is unavailable or insufficient. ` +
      "Fix the architecture view or omit the unsupported consumer section.",
    );
  }
  return figures.next(kind, source);
}

function pushExecutive(sections: PublicationSection[], model: SystemModel, view: DocumentationViewModel): void {
  const type = model.product.type || "application";
  const description = firstSentence(model.product.description);
  const facts: string[] = [];
  facts.push(`${model.components.length} software component${model.components.length === 1 ? "" : "s"}`);
  const primary = view.components.filter((c) => c.presentation === "primary").map((c) => c.displayName);
  if (primary.length > 0) facts.push(`primary: ${primary.slice(0, 6).join(", ")}`);
  const compose = model.infrastructure.filter((item) => item.type === "docker-service");
  if (compose.length > 0) facts.push(`${compose.length} Compose service${compose.length === 1 ? "" : "s"}`);
  if (model.datastores.length > 0) facts.push(`${model.datastores.length} datastore${model.datastores.length === 1 ? "" : "s"}`);
  if (view.apiRouteCount > 0) facts.push(`${view.apiRouteCount} local API route${view.apiRouteCount === 1 ? "" : "s"}`);
  const fleet = model.infrastructure.find((item) => item.type === "device-fleet");
  const systemd = model.infrastructure.filter((item) => item.type === "systemd-service");
  if (fleet) facts.push(`deployed as a fleet application (${fleet.name})`);
  else if (compose.length > 0) facts.push("deployed with Docker Compose");
  else if (systemd.length > 0) facts.push(`deployed as systemd service ${systemd.map((s) => s.name).join(", ")}`);
  const deviceIfaces = (model.devices ?? []).filter((d) => d.kind !== "device-service" && d.kind !== "device");
  if (deviceIfaces.length > 0) {
    facts.push(`${deviceIfaces.length} evidenced device/peripheral interface${deviceIfaces.length === 1 ? "" : "s"}`);
  }
  const languages = [...model.runtime.map((r) => r.name), ...model.languages.map((l) => l.name)];
  const blocks: PublicationBlock[] = [
    para(`${model.product.name} is ${article(type)} ${type}.${description ? ` ${description}` : ""}`),
    bullets(facts),
  ];
  if (languages.length > 0) {
    blocks.push(para(`Major languages/runtimes: ${languages.join(", ")}.`));
  }
  sections.push(section("executive-summary", "Executive Technical Summary", blocks));
}

function pushContext(sections: PublicationSection[], model: SystemModel, view: DocumentationViewModel): void {
  const inside: string[] = [];
  if (model.components.length > 0) {
    inside.push(`Software structure: ${model.components.length} component${model.components.length === 1 ? "" : "s"} (${model.components.map((c) => c.displayName ?? c.name).join(", ")}).`);
  }
  if (model.runtime.length + model.languages.length > 0) {
    inside.push(`Runtime/languages: ${[...model.runtime.map((r) => r.name), ...model.languages.map((l) => l.name)].join(", ")}.`);
  }
  if (model.datastores.length > 0) {
    inside.push(`Storage declared or used in-tree: ${model.datastores.map((d) => d.name).join(", ")}.`);
  }
  const compose = model.infrastructure.filter((i) => i.type === "docker-service");
  if (compose.length > 0) inside.push(`Deployment definitions: ${compose.length} Compose service${compose.length === 1 ? "" : "s"}.`);
  const fleet = model.infrastructure.find((i) => i.type === "device-fleet");
  if (fleet) inside.push(`Fleet manifest: ${fleet.name}.`);
  if (view.apiRouteCount > 0) inside.push(`Local HTTP API surface: ${view.apiRouteCount} App Router route${view.apiRouteCount === 1 ? "" : "s"}.`);
  const ifaces = (model.devices ?? []).filter((d) => d.kind === "peripheral" || d.kind === "communication-interface" || d.kind === "sensor");
  if (ifaces.length > 0) inside.push(`Device/peripheral interfaces evidenced in source: ${ifaces.map((d) => d.name).join(", ")}.`);
  if (inside.length === 0) inside.push("Product metadata from consumer configuration.");

  const outside: string[] = [];
  const outbound = model.integrations.filter((i) => i.type !== "system");
  if (outbound.length > 0) {
    outside.push(`Outbound HTTP systems are referenced as hosts/SDKs (${outbound.length}); their implementations are not in this repository.`);
  }
  if (fleet) outside.push("Physical fleet devices are not inspected; only the fleet application manifest is represented.");
  outside.push("Scanner coverage is not a completeness claim. Undiscovered behavior may exist.");

  sections.push(section("system-context", "System Context", [
    para(`This document describes the technical boundary of the ${model.product.name} repository, ${article(model.product.type)} ${model.product.type}. Facts below are limited to scanner coverage of this tree.`),
    para("Represented in this repository"),
    bullets(inside),
    para("Outside repository evidence"),
    bullets(outside),
  ]));
}

function pushOverview(
  sections: PublicationSection[],
  model: SystemModel,
  config: DocforceConfig,
  view: DocumentationViewModel,
  figures: FigureCounter,
): void {
  if (view.overviewNodes.length === 0) return;
  const spec = viewSpec(view, "system-overview");
  if (!spec.available) return;
  const byCategory = new Map<string, string[]>();
  for (const node of view.overviewNodes) {
    const label = overviewCategoryLabel(node.category);
    const list = byCategory.get(label) ?? [];
    list.push(node.label);
    byCategory.set(label, list);
  }
  sections.push(section("architecture-overview", "Architecture Overview", [
    para("Major categories in the high-level view:"),
    bullets([...byCategory.entries()].map(([label, names]) => `${label}: ${names.join(", ")}`)),
    requireFigure(figures, "system-overview", generateSystemOverview(model, config)),
  ]));
}

function pushSoftware(
  sections: PublicationSection[],
  model: SystemModel,
  config: DocforceConfig,
  view: DocumentationViewModel,
  figures: FigureCounter,
): void {
  const software = view.components.filter((c) => c.presentation !== "utility");
  if (software.length === 0 && model.components.length === 0) return;
  const spec = viewSpec(view, "software-architecture");
  const blocks: PublicationBlock[] = [
    para("Software components are source identities. Compose/container names are deployment identities and are listed with the component when a mapping is evidenced."),
  ];
  if (spec.available) {
    blocks.push(requireFigure(figures, "software-architecture", generateSoftwareArchitecture(model, config)));
  }
  for (const component of software.length > 0 ? software : view.components) {
    blocks.push(...componentBlocks(component, model));
  }
  sections.push(section("software-architecture", "Software Architecture", blocks));
}

function componentBlocks(component: ComponentViewItem, model: SystemModel): PublicationBlock[] {
  const raw = model.components.find((c) => c.id === component.id);
  const items: string[] = [`Source path: ${component.path}`];
  const summary = component.summary ?? (raw ? componentResponsibilitySummary(raw, model) : undefined);
  if (summary) items.push(`Summary: ${summary}`);
  const apiCount = (model.apiRoutes ?? []).filter((route) =>
    route.sourceFile === component.path || route.sourceFile.startsWith(`${component.path}/`),
  ).length;
  if (apiCount > 0) items.push(`Local API ownership: ${apiCount} App Router route${apiCount === 1 ? "" : "s"}.`);
  const localCalls = model.relationships.filter(
    (rel) => rel.from === component.id && rel.type === "calls-api" && rel.to.startsWith("infra:"),
  );
  if (localCalls.length > 0) {
    items.push(`Local service calls: ${localCalls.map((rel) => {
      const name = rel.to.replace(/^infra:/, "");
      const path = httpPath(rel);
      return path ? `${name} (HTTP ${path})` : name;
    }).join("; ")}.`);
  }
  const stores = model.relationships.filter(
    (rel) => rel.from === component.id && rel.to.startsWith("store:") && (
      rel.type === "reads-from" || rel.type === "writes-to" || rel.type === "persists-to"
    ),
  );
  if (stores.length > 0) {
    items.push(`Datastore operations: ${stores.map((rel) => `${verb(rel.type)} ${rel.to.replace(/^store:/, "")}`).join("; ")}.`);
  }
  const ext = model.relationships.filter(
    (rel) => rel.from === component.id && rel.type === "calls-api" && rel.to.startsWith("ext:"),
  );
  if (ext.length > 0) {
    items.push(`External integrations: ${ext.length} outbound HTTP service${ext.length === 1 ? "" : "s"}.`);
  }
  const deploy = model.relationships.find((rel) => rel.from === component.id && rel.type === "deploys");
  const runs = model.relationships.find((rel) => rel.from === component.id && rel.type === "runs-on");
  if (deploy || runs) {
    const service = deploy?.to.replace(/^infra:/, "");
    const fleet = runs ? labelDevice(model, runs.to) : undefined;
    items.push(`Deployment: ${[service ? `Compose service ${service}` : undefined, fleet ? `runs on ${fleet}` : undefined].filter(Boolean).join("; ")}.`);
  }
  return [para(component.displayName), bullets(items)];
}

function pushTechnology(sections: PublicationSection[], model: SystemModel, view: DocumentationViewModel): void {
  const techs = view.technologies;
  if (model.languages.length === 0 && model.runtime.length === 0 && techs.length === 0) return;
  const items: string[] = [];
  if (model.runtime.length > 0) {
    items.push(`Runtimes: ${model.runtime.map((r) => r.version ? `${r.name} ${r.version}` : r.name).join(", ")}`);
  }
  if (model.languages.length > 0) {
    items.push(`Languages: ${model.languages.map((l) => l.version ? `${l.name} ${l.version}` : l.name).join(", ")}`);
  }
  const byPresentation = (key: string) => techs.filter((t) => t.presentation === key);
  addTech(items, "Core platform", byPresentation("core-platform"));
  addTech(items, "Frameworks", byPresentation("framework"));
  const stores = model.datastores.filter((d) => d.type !== "migration-directory" && d.type !== "schema-definition");
  if (stores.length > 0) {
    items.push(`Data/storage: ${stores.map((d) => d.location ? `${d.name} (${d.location})` : d.name).join(", ")}`);
  }
  addTech(items, "Infrastructure/deployment", byPresentation("infrastructure"));
  addTech(items, "Major capability libraries", byPresentation("capability-library"));
  addTech(items, "External integration libraries", byPresentation("external-integration"));
  sections.push(section("technology-stack", "Technology Stack", [
    bullets(items),
    para("Supporting and development packages are omitted here. See the Technology Appendix and technology-inventory.md."),
  ]));
}

function addTech(items: string[], heading: string, techs: readonly { name: string; version?: string }[]): void {
  if (techs.length === 0) return;
  items.push(`${heading}: ${techs.map((item) => item.version ? `${item.name} ${item.version}` : item.name).join(", ")}`);
}

function pushApi(sections: PublicationSection[], view: DocumentationViewModel): void {
  if (view.apiRouteCount === 0) return;
  const sorted = [...view.apiGroups].sort((a, b) => b.routes.length - a.routes.length || a.group.localeCompare(b.group));
  sections.push(section("api-architecture", "Local API Architecture", [
    para(`${view.apiRouteCount} local API route${view.apiRouteCount === 1 ? " was" : "s were"} detected across ${view.apiGroupCount} top-level path group${view.apiGroupCount === 1 ? "" : "s"}. Groups are the first segment after /api/.`),
    table(["Group", "Routes"], sorted.map((group) => [group.group, String(group.routes.length)])),
    para("Full paths and methods remain in api-inventory.md. A compact listing is in the API Appendix."),
  ]));
}

function pushData(
  sections: PublicationSection[],
  model: SystemModel,
  config: DocforceConfig,
  figures: FigureCounter,
): void {
  const stores = model.datastores.filter((d) => d.type !== "migration-directory" && d.type !== "schema-definition");
  if (stores.length === 0) return;
  const items: string[] = [];
  for (const store of stores) {
    const id = datastoreNodeId(store.name);
    const rels = model.relationships.filter((rel) => rel.to === id);
    const location = store.location ? ` (named database ${store.location})` : "";
    items.push(`${store.name} — ${store.type}${store.engine ? `, engine ${store.engine}` : ""}${location}`);
    if (rels.length === 0) items.push("No operation relationship could be established from repository source.");
    else {
      for (const rel of rels) items.push(`${rel.from} ${verb(rel.type)} ${store.name}`);
    }
  }
  const spec = viewSpec(buildDocumentationViewModel(model, presentationConfig(config)), "data-architecture");
  const blocks: PublicationBlock[] = [bullets(items)];
  if (spec.available) {
    blocks.push(requireFigure(figures, "data-architecture", generateDataArchitecture(model, config)));
  }
  sections.push(section("data-architecture", "Data Architecture", blocks));
}

function pushIntegrations(sections: PublicationSection[], model: SystemModel): void {
  const integrations = model.integrations.filter((i) => i.type !== "system");
  if (integrations.length === 0) return;
  const items: string[] = [];
  for (const group of groupIntegrations(integrations.map((i) => i.name))) {
    if (group.family === "ungrouped") {
      const integ = integrations.find((i) => i.name === group.members[0]);
      items.push(`${integrationLabel(group.members[0]!)} — ${integ?.type ?? "external-api"}${integ?.protocol ? `, ${integ.protocol}` : ""}`);
    } else {
      items.push(`${group.label}: ${group.members.map((m) => integrationLabel(m)).join(", ")}`);
    }
  }
  sections.push(section("external-integrations", "External Integrations", [
    bullets(items),
    para("Grouping is presentation-only. Canonical hosts remain in the inventory and evidence artifacts."),
  ]));
}

function pushDevices(
  sections: PublicationSection[],
  model: SystemModel,
  config: DocforceConfig,
  figures: FigureCounter,
): void {
  const devices = (model.devices ?? []).filter((d) => d.kind !== "device-service");
  if (devices.length === 0) return;
  const spec = viewSpec(buildDocumentationViewModel(model, presentationConfig(config)), "device-architecture");
  const blocks: PublicationBlock[] = [
    para("Only interfaces evidenced in this repository are listed. Physical hardware is not observed. Undocumented hardware families are omitted rather than assumed."),
    table(["Name", "Kind", "Detail"], devices.map((d) => [d.name, d.kind, d.detail ?? "—"])),
  ];
  const rels = model.relationships.filter(
    (rel) => (rel.type === "attached-to" || rel.type === "communicates-over") && devices.some((d) => d.id === rel.to),
  );
  if (rels.length > 0) {
    blocks.push(para("Evidence-backed connections:"));
    blocks.push(bullets(rels.map((rel) =>
      `${rel.from} ${rel.type === "communicates-over" ? "communicates over" : "attached to"} ${labelDevice(model, rel.to)}`,
    )));
  }
  if (spec.available) {
    blocks.push(requireFigure(figures, "device-architecture", generateDeviceArchitecture(model, config)));
  }
  sections.push(section("device-architecture", "Device & Peripheral Architecture", blocks));
}

function pushDeployment(
  sections: PublicationSection[],
  model: SystemModel,
  config: DocforceConfig,
  figures: FigureCounter,
): void {
  const services = model.infrastructure.filter((i) => i.type === "docker-service" || i.type === "systemd-service");
  const fleet = model.infrastructure.filter((i) => i.type === "device-fleet");
  if (services.length === 0 && fleet.length === 0) return;
  const blocks: PublicationBlock[] = [];
  if (fleet.length > 0) {
    blocks.push(para(`Fleet / deployment target: ${fleet.map((item) => item.name).join(", ")}`));
  }
  const softwareNames = new Set(model.components.map((c) => c.id).concat(model.components.map((c) => c.name)));
  if (services.length > 0) {
    blocks.push(para("Services"));
    blocks.push(bullets(services.map((svc) => {
      const label = svc.type === "docker-service" ? serviceDisplayLabel(svc.name, softwareNames) : svc.name;
      const mapped = model.relationships.find((rel) => rel.type === "deploys" && rel.to === `infra:${svc.name}`);
      const mapping = mapped ? ` — software component ${mapped.from}` : "";
      const detail = flagshipServiceDetail(svc.detail);
      return `${label} (${svc.name})${mapping}${detail ? ` — ${detail}` : ""}`;
    })));
  }
  const depends = model.relationships.filter((rel) => rel.type === "depends-on" && rel.from.startsWith("infra:"));
  if (depends.length > 0) {
    blocks.push(para("Service dependencies:"));
    blocks.push(bullets(depends.map((rel) =>
      `${rel.from.replace(/^infra:/, "")} depends_on ${rel.to.replace(/^infra:/, "")}`,
    )));
  }
  const volumes = model.infrastructure.filter((i) => i.type === "docker-volume");
  const mounts = model.relationships.filter((rel) => rel.type === "mounts");
  if (volumes.length > 0) {
    blocks.push(para("Named volumes"));
    blocks.push(bullets(volumes.map((vol) => {
      const usedBy = mounts.filter((rel) => rel.to === `infra:${vol.name}`);
      const usage = usedBy.length > 0
        ? usedBy.map((rel) => {
          const svc = rel.from.replace(/^infra:/, "");
          const target = mountTarget(rel);
          return target ? `${svc} at ${target}` : svc;
        }).join("; ")
        : "no evidenced service mount";
      return `${vol.name} — ${usage}`;
    })));
  }
  const images = aggregateContainerImages(model.infrastructure.filter((i) => i.type === "container-image"));
  if (images.length > 0) {
    blocks.push(para("Container images"));
    blocks.push(bullets(images.map((image) => `${image.name} — used by ${image.count} Dockerfile${image.count === 1 ? "" : "s"}`)));
  }
  const ports = model.infrastructure.filter((i) => i.type === "exposed-port");
  if (ports.length > 0) {
    blocks.push(para(`Exposed ports: ${ports.map((p) => p.name).join(", ")}.`));
  }
  const spec = viewSpec(buildDocumentationViewModel(model, presentationConfig(config)), "deployment-architecture");
  if (spec.available) {
    blocks.push(requireFigure(figures, "deployment-architecture", generateDeploymentArchitecture(model, config)));
  }
  sections.push(section("deployment-architecture", "Deployment Architecture", blocks));
}

function pushRuntime(sections: PublicationSection[], model: SystemModel): void {
  const names = envNames(model);
  if (names.length === 0) return;
  const counts = new Map<EnvArea, number>();
  for (const name of names) {
    const area = classifyEnvVar(name);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const items: string[] = [];
  for (const area of envAreaOrder()) {
    if (!envAreas(names).includes(area)) continue;
    items.push(`${configAreaLabel(area)}: ${counts.get(area) ?? 0}`);
  }
  sections.push(section("runtime-configuration", "Runtime Configuration", [
    para(`${names.length} environment-variable names were discovered from Compose service definitions. Values are not documented.`),
    bullets(items),
    para("Complete variable names are listed in the Runtime Configuration Appendix. Values are never published."),
  ]));
}

function pushCoverage(sections: PublicationSection[], view: DocumentationViewModel): void {
  if (view.coverage.length === 0) return;
  sections.push(section("documentation-coverage", "Documentation Coverage", [
    {
      kind: "callout",
      tone: "coverage",
      title: "Documentation Coverage",
      text: "Status is scanner coverage, not documentation completeness.",
    },
    table(
      ["Area", "Status", "Notes"],
      view.coverage.map((area) => [area.area, area.status, area.notes]),
    ),
  ]));
}

function pushUnknowns(sections: PublicationSection[], model: SystemModel): void {
  const unknowns = model.unknowns.filter((unk) => unk.area !== "Architecture Rationale");
  const items = unknowns.length > 0
    ? unknowns.map((unk) => `${unk.area}: ${unk.description}${unk.reason ? ` (${unk.reason})` : ""}`)
    : ["No additional scanner unknowns were recorded beyond coverage limits."];
  sections.push(section("unknowns", "Known Technical Gaps / Unknowns", [
    {
      kind: "callout",
      tone: "unknown",
      title: "Unknown / Unverified",
      text: "The following items are not established as structured repository evidence.",
    },
    bullets(items),
    {
      kind: "callout",
      tone: "limitation",
      title: "Important limitation",
      text: "Architecture selection rationale is not currently available as structured, validated repository evidence.",
    },
  ]));
}

function pushAppendices(
  sections: PublicationSection[],
  model: SystemModel,
  view: DocumentationViewModel,
): void {
  const supporting = view.technologies.filter(
    (t) => t.presentation === "supporting-library" || t.presentation === "development-tool",
  );
  if (supporting.length > 0) {
    sections.push(section("appendix-technology", "Appendix A — Technology", [
      para("Supporting and development packages omitted from the main Technology Stack."),
      table(["Name", "Class"], supporting.map((t) => [t.name, t.presentation])),
      para("The full inventory remains in docs/generated/technology-inventory.md."),
    ], true));
  }

  if (view.apiRouteCount > 0) {
    const rows = view.apiGroups.flatMap((group) =>
      group.routes.slice(0, 3).map((route) => [group.group, route.path, route.methods.join(", ")]),
    );
    sections.push(section("appendix-api", "Appendix B — API", [
      para("Sample routes per group. The complete inventory remains in docs/generated/api-inventory.md."),
      table(["Group", "Path", "Methods"], rows),
    ], true));
  }

  const names = envNames(model);
  if (names.length > 0) {
    const byArea = new Map<string, string[]>();
    for (const name of names) {
      const area = configAreaLabel(classifyEnvVar(name));
      const list = byArea.get(area) ?? [];
      list.push(name);
      byArea.set(area, list);
    }
    sections.push(section("appendix-configuration", "Appendix C — Runtime Configuration", [
      para("Environment-variable names only. Secret values are not published."),
      table(
        ["Category", "Variable names"],
        [...byArea.entries()].map(([area, vars]) => [area, vars.sort().join(", ")]),
      ),
    ], true));
  }
}

function envNames(model: SystemModel): string[] {
  const names: string[] = [];
  for (const svc of model.infrastructure.filter((item) => item.type === "docker-service")) {
    names.push(...parseEnvNamesFromDetail(svc.detail));
  }
  return names;
}

function envAreaOrder(): EnvArea[] {
  return [
    "service URLs",
    "credentials",
    "ports",
    "timeouts",
    "audio/device",
    "watchdog/operations",
    "runtime",
  ];
}

function firstSentence(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed.match(/^[^.]+(?:\.)?/)?.[0]?.trim() ?? trimmed;
}

function verb(type: string): string {
  switch (type) {
    case "reads-from": return "reads from";
    case "writes-to": return "writes to";
    case "persists-to": return "persists to";
    default: return type;
  }
}

function httpPath(rel: Relationship): string | undefined {
  const paths = rel.evidence
    .filter((item) => item.evidenceType === "http-request-path")
    .map((item) => item.detail?.match(/(\/[A-Za-z0-9._~/-]+)/)?.[1])
    .filter((path): path is string => Boolean(path));
  const unique = [...new Set(paths)];
  return unique.length > 0 ? unique.join(", ") : undefined;
}

function flagshipServiceDetail(detail?: string): string | undefined {
  if (!detail) return undefined;
  const kept = detail.split("; ").filter((part) => !/^env\s+/i.test(part.trim()));
  return kept.length > 0 ? kept.join("; ") : undefined;
}

function article(word: string): "a" | "an" {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a";
}

function mountTarget(rel: Relationship): string | undefined {
  const detail = rel.evidence[0]?.detail ?? rel.description ?? "";
  return detail.match(/ at (\S+)$/)?.[1];
}

function labelDevice(model: SystemModel, id: string): string {
  const device = (model.devices ?? []).find((item) => item.id === id);
  if (device) return device.name;
  const fleet = model.infrastructure.find((item) => item.type === "device-fleet" && (`infra:${item.name}` === id || item.name === id));
  return fleet?.name ?? id.replace(/^.*:/, "");
}

function configAreaLabel(area: EnvArea): string {
  switch (area) {
    case "service URLs": return "service endpoints";
    case "credentials": return "credentials/secrets references";
    case "ports": return "ports";
    case "timeouts": return "timeout/retry settings";
    case "audio/device": return "audio/device settings";
    case "watchdog/operations": return "watchdog/operations settings";
    case "runtime": return "runtime";
    default: {
      const exhaustive: never = area;
      return exhaustive;
    }
  }
}
