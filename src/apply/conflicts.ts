import type { SystemModel } from "../model/types.js";

/**
 * Deterministic checks that proposed documentation does not contradict
 * the current System Model. No AI is involved.
 */
export function detectApplyConflicts(proposedContent: string, model: SystemModel): string[] {
  const errors: string[] = [];
  const lower = proposedContent.toLowerCase();

  const knownDatastores = model.datastores.map((d) => d.name.toLowerCase());
  const commonDatabases = ["postgresql", "postgres", "mysql", "mongodb", "redis", "sqlite", "dynamodb", "cassandra"];
  for (const db of commonDatabases) {
    if (lower.includes(db) && !knownDatastores.some((d) => d.includes(db))) {
      const actual = model.datastores.map((d) => d.name).join(", ") || "none detected";
      errors.push(`Deterministic conflict: proposal mentions "${db}" but model datastores are ${actual}`);
    }
  }

  const knownIntegrations = model.integrations.map((i) => i.name.toLowerCase());
  const commonIntegrations = ["slack", "github", "jira", "linear", "stripe", "twilio", "sendgrid"];
  for (const integ of commonIntegrations) {
    if (lower.includes(integ) && !knownIntegrations.some((i) => i.includes(integ))) {
      const actual = model.integrations.map((i) => i.name).join(", ") || "none detected";
      errors.push(`Deterministic conflict: proposal mentions "${integ}" but model integrations are ${actual}`);
    }
  }

  for (const integ of model.integrations) {
    const name = integ.name.toLowerCase();
    const denies = new RegExp(`no ${name}|does not (use|have|include) ${name}|without ${name}`, "i");
    if (denies.test(lower)) {
      errors.push(`Deterministic conflict: integration "${integ.name}" exists but proposal denies it`);
    }
  }
  for (const ds of model.datastores) {
    const name = ds.name.toLowerCase();
    const denies = new RegExp(`no ${name}|does not (use|have|store).{0,20}${name}`, "i");
    if (denies.test(lower)) {
      errors.push(`Deterministic conflict: datastore "${ds.name}" exists but proposal denies it`);
    }
  }

  return errors;
}
