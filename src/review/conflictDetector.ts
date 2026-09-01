import type { SystemModel } from "../model/types.js";
import type { AiChangeAssessment, AiConflict } from "./types.js";

export function detectConflicts(
  assessment: AiChangeAssessment,
  model: SystemModel,
): AiConflict[] {
  const conflicts: AiConflict[] = [];

  const summary = assessment.summary.toLowerCase();
  const allReasons = assessment.documentationRecommendations.map((r) => r.reason.toLowerCase()).join(" ");
  const allText = `${summary} ${allReasons}`;

  const knownDatastores = model.datastores.map((d) => d.name.toLowerCase());
  const commonDatabases = ["postgresql", "postgres", "mysql", "mongodb", "redis", "sqlite", "dynamodb", "cassandra"];

  for (const db of commonDatabases) {
    const aiMentions = allText.includes(db);
    const deterministicHas = knownDatastores.some((d) => d.includes(db));

    if (aiMentions && !deterministicHas) {
      const actualStores = model.datastores.map((d) => d.name).join(", ") || "none detected";
      conflicts.push({
        field: "datastores",
        deterministicFact: actualStores,
        aiClaim: `AI mentions "${db}" in its analysis`,
        resolution: "deterministic fact retained — AI claim may indicate scanner limitation or hallucination",
      });
    }
  }

  const knownIntegrations = model.integrations.map((i) => i.name.toLowerCase());
  const commonIntegrations = ["slack", "github", "jira", "linear", "stripe", "twilio", "sendgrid", "aws", "azure", "gcp"];

  for (const integ of commonIntegrations) {
    const aiMentions = allText.includes(integ);
    const deterministicHas = knownIntegrations.some((i) => i.includes(integ));

    if (aiMentions && !deterministicHas) {
      const actualIntegrations = model.integrations.map((i) => i.name).join(", ") || "none detected";
      conflicts.push({
        field: "integrations",
        deterministicFact: actualIntegrations,
        aiClaim: `AI mentions "${integ}" in its analysis`,
        resolution: "deterministic fact retained — AI claim may indicate scanner limitation or hallucination",
      });
    }
  }

  return conflicts;
}
