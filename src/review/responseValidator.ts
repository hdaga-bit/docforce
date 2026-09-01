import { AiChangeAssessmentSchema } from "./types.js";
import type { AiChangeAssessment, AiReviewInput, AiEvidenceReference, FileContext } from "./types.js";

export interface ValidationResult {
  readonly valid: boolean;
  readonly assessment?: AiChangeAssessment;
  readonly errors: readonly string[];
  readonly evidenceDowngraded: boolean;
}

export function validateAiResponse(
  raw: unknown,
  input: AiReviewInput,
): ValidationResult {
  const errors: string[] = [];
  let evidenceDowngraded = false;

  const parseResult = AiChangeAssessmentSchema.safeParse(raw);
  if (!parseResult.success) {
    const zodErrors = parseResult.error.issues.map((i) =>
      `${i.path.join(".")}: ${i.message}`
    );
    return { valid: false, errors: zodErrors, evidenceDowngraded: false };
  }

  let assessment = parseResult.data;
  const suppliedByPath = new Map(input.changedFiles.map((f) => [f.path, f]));

  const validEvidence = assessment.evidence.filter((e) => {
    const check = validateEvidenceRef(e, suppliedByPath);
    if (!check.ok) {
      errors.push(check.reason);
      evidenceDowngraded = true;
      return false;
    }
    return true;
  });

  const validRecommendations = assessment.documentationRecommendations.map((rec) => {
    const validRecEvidence = rec.evidence.filter((e) => {
      const check = validateEvidenceRef(e, suppliedByPath);
      if (!check.ok) {
        errors.push(check.reason);
        evidenceDowngraded = true;
        return false;
      }
      return true;
    });
    return { ...rec, evidence: validRecEvidence };
  });

  const adjustedRecommendations = validRecommendations.map((rec) => {
    if ((rec.impact === "medium" || rec.impact === "high") && rec.evidence.length === 0) {
      errors.push(
        `Recommendation for "${rec.area}" has ${rec.impact} impact but no valid evidence — ` +
        `downgraded to "low" and marked for human confirmation`,
      );
      evidenceDowngraded = true;
      return { ...rec, impact: "low" as const };
    }
    return rec;
  });

  let confidence = assessment.confidence;
  let requiresHumanConfirmation = assessment.requiresHumanConfirmation;
  if (evidenceDowngraded && (confidence === "high" || confidence === "medium")) {
    const next = confidence === "high" ? "medium" : "low";
    errors.push(`Confidence downgraded from ${confidence} to ${next} due to evidence issues`);
    confidence = next;
  }
  if (evidenceDowngraded) {
    requiresHumanConfirmation = true;
  }

  if (validEvidence.length === 0 && assessment.behavioralChangeDetected && confidence === "high") {
    confidence = "medium";
    requiresHumanConfirmation = true;
    errors.push("No valid evidence for a behavioral claim — confidence cannot remain high");
    evidenceDowngraded = true;
  }

  assessment = {
    ...assessment,
    evidence: validEvidence,
    documentationRecommendations: adjustedRecommendations,
    confidence,
    requiresHumanConfirmation,
  };

  return {
    valid: true,
    assessment,
    errors,
    evidenceDowngraded,
  };
}

function validateEvidenceRef(
  ref: AiEvidenceReference,
  suppliedByPath: Map<string, FileContext>,
): { ok: true } | { ok: false; reason: string } {
  const path = ref.path.replace(/\\/g, "/");

  if (path.includes("..") || path.startsWith("/") || path.startsWith("~")) {
    return { ok: false, reason: `Evidence path "${ref.path}" is outside the repository or uses traversal — removed` };
  }

  const file = suppliedByPath.get(ref.path) ?? suppliedByPath.get(path);
  if (!file) {
    return { ok: false, reason: `Evidence path "${ref.path}" was not in supplied context — removed` };
  }

  if (ref.startLine && ref.endLine && ref.startLine > ref.endLine) {
    return { ok: false, reason: `Evidence ${ref.path}:${ref.startLine}-${ref.endLine} has invalid line range — removed` };
  }

  const available = file.availableLineNumbers;
  if (available && available.length > 0 && ref.startLine) {
    const min = Math.min(...available);
    const max = Math.max(...available);
    const startOk = ref.startLine >= min && ref.startLine <= max;
    const endOk = !ref.endLine || (ref.endLine >= min && ref.endLine <= max);
    if (!startOk || !endOk) {
      return {
        ok: false,
        reason: `Evidence ${ref.path}:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ""} is outside supplied line range ${min}-${max} — removed`,
      };
    }
  }

  return { ok: true };
}
