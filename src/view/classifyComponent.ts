import type { ComponentPresentation, DocforceConfig } from "../config/types.js";
import type { ComponentInfo, SystemModel } from "../model/types.js";
import { componentResponsibilitySummary } from "./componentSummary.js";
import type { ComponentViewItem, ComponentViewPresentation } from "./types.js";
import { COMPONENT_PRESENTATIONS } from "./types.js";

export function isValidComponentPresentation(value: string): value is ComponentViewPresentation {
  return (COMPONENT_PRESENTATIONS as readonly string[]).includes(value);
}

export function classifyComponent(
  component: ComponentInfo,
  model: SystemModel,
  config: DocforceConfig,
): ComponentViewItem {
  const degree = model.relationships.filter(
    (r) => r.from === component.id || r.to === component.id,
  ).length;

  const overridePresentation =
    config.documentation.componentOverrides?.[component.id]?.presentation ??
    config.architecture.components?.[component.id]?.presentation;

  const reasons: string[] = [];
  let presentation: ComponentViewPresentation = "neutral";

  const includeInOverview = config.architecture.components?.[component.id]?.includeInOverview;

  if (overridePresentation && isValidComponentPresentation(overridePresentation)) {
    presentation = overridePresentation;
    reasons.push("consumer presentation override");
  } else if (includeInOverview === false) {
    presentation = "utility";
    reasons.push("includeInOverview is false");
  } else {
    const signals = collectSignals(component, model, degree);
    reasons.push(...signals.reasons);
    presentation = signals.presentation;
  }

  return {
    id: component.id,
    name: component.name,
    path: component.path,
    displayName: component.displayName ?? component.name,
    type: component.type,
    presentation,
    degree,
    reasons,
    evidence: component.provenance.evidence,
    summary: componentResponsibilitySummary(component, model),
  };
}

function collectSignals(
  component: ComponentInfo,
  model: SystemModel,
  degree: number,
): { presentation: ComponentViewPresentation; reasons: string[] } {
  const reasons: string[] = [];
  let primary = false;
  let supporting = false;

  if ((component.entryPoints ?? []).length > 0) {
    primary = true;
    reasons.push("entry point evidence");
  }

  const matchingService = model.infrastructure.some(
    (item) => item.type === "docker-service" && namesMatch(item.name, component),
  );
  if (matchingService) {
    primary = true;
    reasons.push("matching compose service");
  }

  const ownsApi = (model.apiRoutes ?? []).some((route) =>
    routeBelongsToComponent(route.sourceFile, component.path),
  );
  if (ownsApi) {
    primary = true;
    reasons.push("App Router API routes under component path");
  }

  const isAppRouterRoot = (model.apiRoutes ?? []).some((route) =>
    route.sourceFile.startsWith("app/") && (component.path === "app" || component.path === "src/app"),
  );
  if (isAppRouterRoot) {
    primary = true;
    reasons.push("App Router root convention with API route evidence");
  }

  if (degree >= 4) {
    primary = true;
    reasons.push(`relationship degree ${degree}`);
  } else if (degree >= 2) {
    supporting = true;
    reasons.push(`relationship degree ${degree}`);
  }

  if (primary) return { presentation: "primary", reasons };
  if (supporting) return { presentation: "supporting", reasons };
  if (reasons.length === 0) {
    reasons.push("insufficient confidence for a presentation tier");
  }
  return { presentation: "neutral", reasons };
}

function namesMatch(serviceName: string, component: ComponentInfo): boolean {
  return serviceName === component.id || serviceName === component.name;
}

export function routeBelongsToComponent(sourceFile: string, componentPath: string): boolean {
  const normalizedPath = componentPath.replace(/\/$/, "");
  return sourceFile === normalizedPath || sourceFile.startsWith(`${normalizedPath}/`);
}

export function classifyComponents(
  model: SystemModel,
  config: DocforceConfig,
): ComponentViewItem[] {
  return model.components.map((component) => classifyComponent(component, model, config));
}

export function presentationOverrideValue(value: ComponentPresentation | undefined): ComponentViewPresentation | undefined {
  return value && isValidComponentPresentation(value) ? value : undefined;
}
