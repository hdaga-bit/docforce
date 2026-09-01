import type { SystemModel, Provenance, Relationship } from "../model/types.js";
import { RELATIONSHIP_TYPES } from "../model/types.js";
import { evidenceSupportsRelationship } from "../model/evidenceTypes.js";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
}

export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

export interface ValidationWarning {
  readonly path: string;
  readonly message: string;
}

export interface ValidationOptions {
  readonly scannerSourcePaths?: readonly string[];
}

const DEFAULT_SCANNER_SOURCE_PATHS: readonly string[] = [
  "src/docforce/scanner/",
  "src/docforce/generator/",
  "src/docforce/validator/",
  "src/docforce/model/",
  "src/docforce/config/",
  "src/docforce/cli.ts",
  "node_modules/@mary/docforce/",
  "packages/docforce/",
];

export function validateSystemModel(
  model: SystemModel,
  options?: ValidationOptions,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  validateMetadata(model, errors);
  validateProduct(model, errors);
  validateProvenancedArrays(model, errors, warnings);
  validateNoFabricatedRationale(model, errors);
  validateEvidenceOrigin(model, errors, warnings, options);
  validateRelationships(model, errors, warnings);
  validateUnknowns(model, errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateMetadata(model: SystemModel, errors: ValidationError[]): void {
  if (!model.metadata.schemaVersion) {
    errors.push({ path: "metadata.schemaVersion", message: "Schema version is required" });
  }
  if (!model.metadata.docforceVersion) {
    errors.push({ path: "metadata.docforceVersion", message: "DocForce version is required" });
  }
  if (!model.metadata.repositoryName) {
    errors.push({ path: "metadata.repositoryName", message: "Repository name is required" });
  }
  if (!model.metadata.repositoryRoot) {
    errors.push({ path: "metadata.repositoryRoot", message: "Repository root is required" });
  }
  if (!model.metadata.generatedAt) {
    errors.push({ path: "metadata.generatedAt", message: "Generation timestamp is required" });
  }
}

function validateProduct(model: SystemModel, errors: ValidationError[]): void {
  if (!model.product.name) {
    errors.push({ path: "product.name", message: "Product name is required" });
  }
  if (!model.product.type) {
    errors.push({ path: "product.type", message: "Product type is required" });
  }
}

function validateProvenancedArrays(
  model: SystemModel,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  const arrays: { name: string; items: readonly { provenance: Provenance }[] }[] = [
    { name: "runtime", items: model.runtime },
    { name: "languages", items: model.languages },
    { name: "technologies", items: model.technologies },
    { name: "components", items: model.components },
    { name: "datastores", items: model.datastores },
    { name: "integrations", items: model.integrations },
    { name: "infrastructure", items: model.infrastructure },
    { name: "workflows", items: model.workflows },
  ];

  for (const { name, items } of arrays) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const path = `${name}[${i}]`;

      if (!item.provenance) {
        errors.push({ path: `${path}.provenance`, message: "Provenance is required for all facts" });
        continue;
      }

      if (!item.provenance.kind) {
        errors.push({ path: `${path}.provenance.kind`, message: "Evidence kind is required" });
      }

      if (!item.provenance.confidence) {
        errors.push({ path: `${path}.provenance.confidence`, message: "Confidence level is required" });
      }

      if (!item.provenance.evidence || item.provenance.evidence.length === 0) {
        if (item.provenance.kind !== "unknown") {
          errors.push({
            path: `${path}.provenance.evidence`,
            message: "Observations and inferences must have at least one evidence entry",
          });
        }
      }

      for (let j = 0; j < (item.provenance.evidence?.length ?? 0); j++) {
        const ev = item.provenance.evidence[j]!;
        if (!ev.sourceFile) {
          errors.push({
            path: `${path}.provenance.evidence[${j}].sourceFile`,
            message: "Evidence must reference a source file",
          });
        }
      }

      if (item.provenance.kind === "inference" && item.provenance.confidence === "high") {
        warnings.push({
          path: `${path}.provenance`,
          message: "Inferences should typically not have high confidence — consider if this is actually an observation",
        });
      }
    }
  }
}

function validateNoFabricatedRationale(model: SystemModel, errors: ValidationError[]): void {
  const arrays: { name: string; items: readonly { provenance: Provenance }[] }[] = [
    { name: "runtime", items: model.runtime },
    { name: "languages", items: model.languages },
    { name: "technologies", items: model.technologies },
    { name: "components", items: model.components },
    { name: "datastores", items: model.datastores },
    { name: "integrations", items: model.integrations },
    { name: "infrastructure", items: model.infrastructure },
    { name: "workflows", items: model.workflows },
  ];

  for (const { name, items } of arrays) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (!item.provenance) continue;
      if (
        item.provenance.kind === "unknown" &&
        item.provenance.reasoning &&
        item.provenance.reasoning.length > 0
      ) {
        errors.push({
          path: `${name}[${i}].provenance`,
          message: "Unknown-kind items must not carry engineering rationale",
        });
      }
    }
  }
}

function validateEvidenceOrigin(
  model: SystemModel,
  errors: ValidationError[],
  _warnings: ValidationWarning[],
  options?: ValidationOptions,
): void {
  const scannerPaths = options?.scannerSourcePaths ?? DEFAULT_SCANNER_SOURCE_PATHS;

  const sensitiveArrays: { name: string; items: readonly { provenance: Provenance }[] }[] = [
    { name: "integrations", items: model.integrations },
    { name: "datastores", items: model.datastores },
  ];

  for (const { name, items } of sensitiveArrays) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (!item.provenance?.evidence?.length) continue;

      const allFromScanner = item.provenance.evidence.every((ev) =>
        scannerPaths.some((sp) => ev.sourceFile.startsWith(sp)),
      );

      if (allFromScanner) {
        errors.push({
          path: `${name}[${i}].provenance`,
          message:
            `All evidence originates from documentation tooling source (${item.provenance.evidence.map((e) => e.sourceFile).join(", ")}). ` +
            `Findings must be supported by repository source code, not scanner implementation files.`,
        });
      }
    }
  }
}

function validateRelationships(
  model: SystemModel,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  const rels = model.relationships ?? [];

  const componentIds = new Set(model.components.map((c) => c.id));
  const integrationIds = new Set(model.integrations.map((i) => `ext:${i.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`));
  const datastoreIds = new Set(
    model.datastores
      .filter((d) => d.type !== "migration-directory" && d.type !== "schema-definition")
      .map((d) => `store:${d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`),
  );
  const INFRA_RELATION_TYPES = new Set([
    "docker-service",
    "docker-volume",
    "docker-network",
    "systemd-service",
    "device-fleet",
  ]);
  const infrastructureIds = new Set(
    model.infrastructure
      .filter((item) => INFRA_RELATION_TYPES.has(item.type))
      .map((item) => `infra:${item.name}`),
  );
  const allValidNodes = new Set([
    ...componentIds,
    ...integrationIds,
    ...datastoreIds,
    ...infrastructureIds,
    ...(model.devices ?? []).map((d) => d.id),
  ]);
  const allRelIds = new Set(rels.map((r) => r.id));

  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i]!;
    const path = `relationships[${i}]`;

    if (!rel.id) {
      errors.push({ path: `${path}.id`, message: "Relationship id is required" });
    }

    if (!allValidNodes.has(rel.from)) {
      errors.push({ path: `${path}.from`, message: `References unknown node "${rel.from}"` });
    }

    if (!allValidNodes.has(rel.to)) {
      errors.push({ path: `${path}.to`, message: `References unknown node "${rel.to}"` });
    }

    if (!RELATIONSHIP_TYPES.includes(rel.type)) {
      errors.push({ path: `${path}.type`, message: `Unknown relationship type "${rel.type}"` });
    }

    if (rel.classification === "observation" && (!rel.evidence || rel.evidence.length === 0)) {
      errors.push({ path: `${path}.evidence`, message: "Observations must contain direct evidence" });
    }

    if (rel.classification === "inference") {
      if (!rel.derivedFrom || rel.derivedFrom.length === 0) {
        // derivedFrom can reference evidence or relationship IDs — optional for v0.2
        // but we warn if missing
        warnings.push({
          path: `${path}.derivedFrom`,
          message: "Inferences should reference derivedFrom for traceability",
        });
      } else {
        for (const ref of rel.derivedFrom) {
          if (!allRelIds.has(ref)) {
            warnings.push({
              path: `${path}.derivedFrom`,
              message: `derivedFrom references unknown relationship "${ref}"`,
            });
          }
        }
      }
    }

    if (rel.classification === "unknown") {
      warnings.push({
        path: path,
        message: "Unknown-classification relationships should not normally appear in the model",
      });
    }

    // Semantic validation: evidence type must support relationship type
    if (rel.evidence && rel.evidence.length > 0) {
      for (const ev of rel.evidence) {
        if (!evidenceSupportsRelationship(ev.evidenceType, rel.type)) {
          warnings.push({
            path: `${path}.evidence`,
            message: `Evidence type "${ev.evidenceType}" does not semantically support relationship type "${rel.type}"`,
          });
        }
      }
    }

    // Self-relationships
    if (rel.from === rel.to) {
      warnings.push({
        path: path,
        message: `Self-relationship on "${rel.from}" — verify this is intentional`,
      });
    }
  }
}

function validateUnknowns(model: SystemModel, errors: ValidationError[]): void {
  for (let i = 0; i < model.unknowns.length; i++) {
    const unknown = model.unknowns[i]!;
    if (!unknown.area) {
      errors.push({ path: `unknowns[${i}].area`, message: "Unknown area name is required" });
    }
    if (!unknown.reason) {
      errors.push({ path: `unknowns[${i}].reason`, message: "Unknown area must have a reason" });
    }
  }
}
