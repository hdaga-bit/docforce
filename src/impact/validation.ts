import type { ChangeImpactReport, ModelDomain } from "./types.js";
import { getRegisteredArtifacts } from "./documentRegistry.js";

export interface ImpactValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const KNOWN_DOMAINS: readonly ModelDomain[] = [
  "product", "technologies", "components", "integrations",
  "datastores", "infrastructure", "relationships", "workflows",
  "architecture-presentation", "evidence",
];

const VOLATILE_FIELDS = new Set(["generatedAt", "configHash", "dirty", "repositoryRoot"]);

export function validateImpactReport(report: ChangeImpactReport): ImpactValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const registeredArtifacts = new Set(getRegisteredArtifacts());

  for (const di of report.documentImpacts) {
    if (!registeredArtifacts.has(di.artifact)) {
      errors.push(`Document "${di.artifact}" is not in the document dependency registry`);
    }
  }

  for (const ec of report.modelDelta.entityChanges) {
    if (!KNOWN_DOMAINS.includes(ec.domain)) {
      errors.push(`Entity change references unknown domain "${ec.domain}"`);
    }
  }

  if (report.overallImpactLevel === "architectural") {
    const hasStructuralChange = report.modelDelta.entityChanges.some((e) =>
      e.domain === "datastores" && (e.changeType === "added" || e.changeType === "removed"),
    ) || report.modelDelta.entityChanges.some((e) =>
      e.domain === "integrations" && (e.changeType === "added" || e.changeType === "removed"),
    );
    if (!hasStructuralChange) {
      warnings.push("Architectural severity reported without major structural entity changes");
    }
  }

  for (const di of report.documentImpacts) {
    if (di.affected && di.triggeringDomains.length === 0) {
      errors.push(`Affected document "${di.artifact}" has no triggering domains`);
    }
    for (const domain of di.triggeringDomains) {
      if (!report.modelDelta.changedDomains.has(domain)) {
        errors.push(`Document "${di.artifact}" references domain "${domain}" which is not in changed domains`);
      }
    }
  }

  for (const ec of report.modelDelta.entityChanges) {
    if (ec.detail && VOLATILE_FIELDS.has(ec.detail)) {
      errors.push(`Entity change "${ec.name}" appears to be based on volatile metadata: ${ec.detail}`);
    }
  }

  for (const ec of report.modelDelta.entityChanges) {
    if (ec.changeType === "removed" && !ec.name) {
      errors.push(`Removed entity in domain "${ec.domain}" has no name`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
