import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findSecretLikeContent } from "../apply/secrets.js";
import { isPathInsideRoot, isPathWithinAllowedRoots, isUnsafeDeclaredPath } from "../path/canonical.js";
import type { DocforceConfig } from "../config/types.js";
import { collectPublicationText, type PublicationDocument } from "./types.js";
import type { DocforcePublicationConfig } from "./config.js";

export interface PublicationValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validatePublicationDocument(
  doc: PublicationDocument,
  config: DocforceConfig,
  repoRoot: string,
  publication: DocforcePublicationConfig,
): PublicationValidationResult {
  const errors: string[] = [];
  const text = collectPublicationText(doc);

  const secret = findSecretLikeContent(text);
  if (secret) {
    errors.push(`Publication rejected: ${secret}`);
  }

  if (/```\s*mermaid/i.test(text) || /(?:^|\n)\s*graph\s+TD\b/i.test(text)) {
    errors.push("Publication rejected: raw Mermaid source must not appear in textual content");
  }

  if (publication.organization.logo) {
    errors.push(...validateLogoPath(repoRoot, publication.organization.logo, config));
  }

  if (!isPathInsideRoot(repoRoot, resolve(repoRoot, publication.outputDir))) {
    errors.push(`Publication outputDir "${publication.outputDir}" is outside the repository`);
  }

  return { valid: errors.length === 0, errors };
}

export function validateLogoPath(
  repoRoot: string,
  logo: string,
  config: DocforceConfig,
): string[] {
  if (isUnsafeDeclaredPath(logo) || logo.split(/[\\/]/).includes("..")) {
    return [`Logo path "${logo}" is unsafe`];
  }
  const allowed = [...config.documentation.allowedRoots, "docs/"];
  if (!isPathWithinAllowedRoots(repoRoot, logo, allowed)) {
    return [`Logo path "${logo}" is outside allowed documentation roots`];
  }
  const abs = resolve(repoRoot, logo);
  if (!existsSync(abs)) {
    return [`Logo file "${logo}" does not exist`];
  }
  return [];
}

export function validateOutputDir(repoRoot: string, outputDir: string): void {
  const abs = resolve(repoRoot, outputDir);
  if (!isPathInsideRoot(repoRoot, abs)) {
    throw new Error(`--output-dir "${outputDir}" resolves outside the repository`);
  }
}
