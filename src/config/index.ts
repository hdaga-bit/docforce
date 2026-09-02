import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DocforceConfig, DocforcePrConfig, PrStatusOutcome, ComponentPresentation, TechnologyPresentation } from "./types.js";
import { DEFAULT_DOCS_OUTPUT, PR_STATUS_OUTCOMES } from "./types.js";
import {
  DEFAULT_PUBLICATION_CONFIG,
  mergePublicationTheme,
  type DocforcePublicationConfig,
} from "../publication/config.js";
import { parseMarginMm, parsePageSize } from "../publication/theme.js";
function parseYamlLite(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  const stack: { indent: number; obj: Record<string, unknown> }[] = [
    { indent: -1, obj: result },
  ];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!.obj;

    if (trimmed.startsWith("- ")) {
      const listValue = trimmed.slice(2).trim();

      // Walk up the stack to find the nearest object with a key that
      // should hold this list.  When "include:" has no inline value the
      // parser creates an empty child object; the real owner is the
      // grandparent.
      let target: Record<string, unknown> | null = null;
      let targetKey: string | undefined;

      for (let s = stack.length - 1; s >= 0; s--) {
        const keys = Object.keys(stack[s]!.obj);
        if (keys.length > 0) {
          target = stack[s]!.obj;
          targetKey = keys[keys.length - 1]!;
          break;
        }
      }

      if (target && targetKey) {
        const existing = target[targetKey];
        if (Array.isArray(existing)) {
          existing.push(unquote(listValue));
        } else {
          target[targetKey] = [unquote(listValue)];
        }
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (rawValue === "" || rawValue === ">") {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, obj: child });

      if (rawValue === ">") {
        const multilineValue = collectMultiline(lines, lines.indexOf(rawLine));
        parent[key] = multilineValue;
      }
    } else {
      parent[key] = unquote(rawValue);
    }
  }

  return result;
}

function collectMultiline(lines: string[], startIdx: number): string {
  const parts: string[] = [];
  let baseIndent: number | null = null;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      if (parts.length > 0) break;
      continue;
    }
    const lineIndent = line.length - line.trimStart().length;
    if (baseIndent === null) baseIndent = lineIndent;
    if (lineIndent < baseIndent) break;
    parts.push(line.trim());
  }
  return parts.join(" ");
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function getString(obj: unknown, ...path: string[]): string {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
}

function getArray(obj: unknown, ...path: string[]): readonly string[] {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== "object") return [];
    current = (current as Record<string, unknown>)[key];
  }
  if (Array.isArray(current)) return current.map(String);
  return [];
}

function getBool(obj: unknown, fallback: boolean, ...path: string[]): boolean {
  const raw = getString(obj, ...path).trim().toLowerCase();
  if (raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function getOutcome(obj: unknown, fallback: PrStatusOutcome, ...path: string[]): PrStatusOutcome {
  const raw = getString(obj, ...path).trim().toLowerCase();
  return (PR_STATUS_OUTCOMES as readonly string[]).includes(raw)
    ? (raw as PrStatusOutcome)
    : fallback;
}

/**
 * Conservative defaults: an unconfigured repository still gets a safe
 * pull-request policy that never silently passes an outstanding concern.
 */
export const DEFAULT_PR_CONFIG: DocforcePrConfig = {
  enabled: true,
  requireDeterministicDocsCurrent: true,
  behavioralReview: { enabled: true },
  aiReview: { enabled: true },
  statusPolicy: {
    deterministicStale: "action-required",
    manualReview: "review",
    aiUnavailableWhenManualReviewRequired: "review",
  },
};

function parsePrConfig(parsed: Record<string, unknown>): DocforcePrConfig {
  const prRaw = parsed["pr"];
  if (!prRaw || typeof prRaw !== "object") return DEFAULT_PR_CONFIG;

  const statusPolicyRaw = (prRaw as Record<string, unknown>)["statusPolicy"];
  const d = DEFAULT_PR_CONFIG;

  return {
    enabled: getBool(prRaw, d.enabled, "enabled"),
    requireDeterministicDocsCurrent: getBool(
      prRaw,
      d.requireDeterministicDocsCurrent,
      "requireDeterministicDocsCurrent",
    ),
    behavioralReview: {
      enabled: getBool(prRaw, d.behavioralReview.enabled, "behavioralReview", "enabled"),
    },
    aiReview: {
      enabled: getBool(prRaw, d.aiReview.enabled, "aiReview", "enabled"),
    },
    statusPolicy: {
      deterministicStale: getOutcome(
        statusPolicyRaw,
        d.statusPolicy.deterministicStale,
        "deterministicStale",
      ),
      manualReview: getOutcome(statusPolicyRaw, d.statusPolicy.manualReview, "manualReview"),
      aiUnavailableWhenManualReviewRequired: getOutcome(
        statusPolicyRaw,
        d.statusPolicy.aiUnavailableWhenManualReviewRequired,
        "aiUnavailableWhenManualReviewRequired",
      ),
    },
  };
}

export function loadConfig(configPath: string): DocforceConfig {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYamlLite(raw);

  const schemaVersion = getString(parsed, "schemaVersion") || "0.1.0";

  const productRaw = parsed["product"];
  const product = {
    name: getString(productRaw, "name"),
    type: getString(productRaw, "type"),
    description: getString(productRaw, "description"),
  };

  if (!product.name) {
    throw new Error("docforce.yml: product.name is required");
  }

  const scanningRaw = parsed["scanning"];
  const scanning = {
    rootDir: getString(scanningRaw, "rootDir") || ".",
    include: getArray(scanningRaw, "include"),
    exclude: getArray(scanningRaw, "exclude"),
  };

  const analysisRaw = parsed["analysis"];
  const analysis = {
    exclude: getArray(analysisRaw, "exclude"),
  };

  const architectureRaw = parsed["architecture"];
  const archComponentsRaw =
    architectureRaw && typeof architectureRaw === "object"
      ? (architectureRaw as Record<string, unknown>)["components"]
      : undefined;

  const archComponents: Record<string, {
    displayName?: string;
    role?: string;
    includeInOverview?: boolean;
    presentation?: ComponentPresentation;
  }> = {};
  if (archComponentsRaw && typeof archComponentsRaw === "object") {
    for (const [compName, val] of Object.entries(archComponentsRaw as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        archComponents[compName] = {
          displayName: getString(val, "displayName") || undefined,
          role: getString(val, "role") || undefined,
          includeInOverview: getString(val, "includeInOverview") === "true" ? true
            : getString(val, "includeInOverview") === "false" ? false
            : undefined,
          presentation: parseComponentPresentation(getString(val, "presentation")),
        };
      }
    }
  }

  const architecture = { components: archComponents };

  const outputRaw = parsed["output"];
  const docsRaw =
    outputRaw && typeof outputRaw === "object" ? (outputRaw as Record<string, unknown>)["docs"] : undefined;

  const output = {
    systemModel: getString(outputRaw, "systemModel") || ".docforce/system-model.json",
    docs: {
      technicalOverview: getString(docsRaw, "technicalOverview") || DEFAULT_DOCS_OUTPUT.technicalOverview,
      technologyInventory: getString(docsRaw, "technologyInventory") || DEFAULT_DOCS_OUTPUT.technologyInventory,
      architectureDiagram: getString(docsRaw, "architectureDiagram") || DEFAULT_DOCS_OUTPUT.architectureDiagram,
      dependencyGraph: getString(docsRaw, "dependencyGraph") || DEFAULT_DOCS_OUTPUT.dependencyGraph,
      architectureEvidence: getString(docsRaw, "architectureEvidence") || DEFAULT_DOCS_OUTPUT.architectureEvidence,
      systemOverview: getString(docsRaw, "systemOverview") || DEFAULT_DOCS_OUTPUT.systemOverview,
      softwareArchitecture: getString(docsRaw, "softwareArchitecture") || DEFAULT_DOCS_OUTPUT.softwareArchitecture,
      deploymentArchitecture: getString(docsRaw, "deploymentArchitecture") || DEFAULT_DOCS_OUTPUT.deploymentArchitecture,
      dataArchitecture: getString(docsRaw, "dataArchitecture") || DEFAULT_DOCS_OUTPUT.dataArchitecture,
      deviceArchitecture: getString(docsRaw, "deviceArchitecture") || DEFAULT_DOCS_OUTPUT.deviceArchitecture,
      apiInventory: getString(docsRaw, "apiInventory") || DEFAULT_DOCS_OUTPUT.apiInventory,
      configurationInventory: getString(docsRaw, "configurationInventory") || DEFAULT_DOCS_OUTPUT.configurationInventory,
      technicalArchitecture: getString(docsRaw, "technicalArchitecture") || DEFAULT_DOCS_OUTPUT.technicalArchitecture,
    },
  };

  const documentationRaw = parsed["documentation"];
  const aiAssistedRaw =
    documentationRaw && typeof documentationRaw === "object"
      ? (documentationRaw as Record<string, unknown>)["aiAssisted"]
      : undefined;

  const aiAssisted: DocforceConfig["documentation"]["aiAssisted"][number][] = [];
  if (aiAssistedRaw && typeof aiAssistedRaw === "object") {
    for (const [area, val] of Object.entries(aiAssistedRaw as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        const path = getString(val, "path");
        const sectionId = getString(val, "sectionId") || getString(val, "section");
        if (!path || !sectionId) continue;
        aiAssisted.push({
          area,
          path,
          sectionId,
          sectionTitle: getString(val, "sectionTitle") || undefined,
          allowCreateSection: getString(val, "allowCreateSection") === "true",
          allowCreateFile: getString(val, "allowCreateFile") === "true",
        });
      }
    }
  }

  const allowedRoots = getArray(documentationRaw, "allowedRoots");
  const documentation = {
    allowedRoots: allowedRoots.length > 0 ? allowedRoots : ["docs/"],
    aiAssisted,
    technologyOverrides: parseTechnologyOverrides(documentationRaw),
    componentOverrides: parseComponentOverrides(documentationRaw),
  };

  const aiRaw = parsed["ai"];
  const claudeRaw = aiRaw && typeof aiRaw === "object"
    ? (aiRaw as Record<string, unknown>)["claude"]
    : undefined;
  const ai = {
    provider: getString(aiRaw, "provider") || undefined,
    claude: {
      command: getString(claudeRaw, "command") || undefined,
    },
  };

  const pr = parsePrConfig(parsed);
  const publication = parsePublicationConfig(parsed);

  return { schemaVersion, product, scanning, analysis, architecture, output, documentation, ai, pr, publication };
}

export function resolveConfigPath(repoRoot: string, configFile?: string): string {
  return resolve(repoRoot, configFile ?? "docforce.yml");
}

const TECHNOLOGY_PRESENTATIONS: readonly TechnologyPresentation[] = [
  "core-platform",
  "language-runtime",
  "framework",
  "datastore",
  "infrastructure",
  "external-integration",
  "capability-library",
  "supporting-library",
  "development-tool",
  "unknown-dependency",
];

const COMPONENT_PRESENTATIONS: readonly ComponentPresentation[] = [
  "primary",
  "supporting",
  "utility",
];

function parseComponentPresentation(raw: string): ComponentPresentation | undefined {
  return (COMPONENT_PRESENTATIONS as readonly string[]).includes(raw)
    ? (raw as ComponentPresentation)
    : undefined;
}

function parseTechnologyOverrides(
  documentationRaw: unknown,
): DocforceConfig["documentation"]["technologyOverrides"] {
  if (!documentationRaw || typeof documentationRaw !== "object") return {};
  const raw = (documentationRaw as Record<string, unknown>)["technologyOverrides"];
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, { presentation: TechnologyPresentation }> = {};
  for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const presentation = getString(val, "presentation");
    if ((TECHNOLOGY_PRESENTATIONS as readonly string[]).includes(presentation)) {
      result[name] = { presentation: presentation as TechnologyPresentation };
    }
  }
  return result;
}

function parseComponentOverrides(
  documentationRaw: unknown,
): DocforceConfig["documentation"]["componentOverrides"] {
  if (!documentationRaw || typeof documentationRaw !== "object") return {};
  const raw = (documentationRaw as Record<string, unknown>)["componentOverrides"];
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, { presentation?: ComponentPresentation }> = {};
  for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    result[name] = { presentation: parseComponentPresentation(getString(val, "presentation")) };
  }
  return result;
}

export { type DocforceConfig, type DocforcePrConfig, type PrStatusOutcome } from "./types.js";

function parsePublicationConfig(parsed: Record<string, unknown>): DocforcePublicationConfig {
  const raw = parsed["publication"];
  if (!raw || typeof raw !== "object") return DEFAULT_PUBLICATION_CONFIG;
  const pub = raw as Record<string, unknown>;
  const footerText = getString(pub, "footer", "text");
  const theme = mergePublicationTheme({
    primaryColor: getString(pub, "theme", "primaryColor") || undefined,
    accentColor: getString(pub, "theme", "accentColor") || undefined,
    headingColor: getString(pub, "theme", "headingColor") || undefined,
    bodyFont: getString(pub, "theme", "bodyFont") || undefined,
    headingFont: getString(pub, "theme", "headingFont") || undefined,
    pageSize: parsePageSize(getString(pub, "theme", "pageSize") || undefined),
    marginMm: parseMarginMm(getString(pub, "theme", "marginMm") || undefined),
    headerText: getString(pub, "theme", "headerText") || undefined,
    footerText: footerText || getString(pub, "theme", "footerText") || undefined,
    tableHeaderFill: getString(pub, "theme", "tableHeaderFill") || undefined,
  });
  return {
    organization: {
      name: getString(pub, "organization", "name"),
      logo: getString(pub, "organization", "logo") || undefined,
    },
    document: {
      title: getString(pub, "document", "title") || DEFAULT_PUBLICATION_CONFIG.document.title,
      classification: getString(pub, "document", "classification"),
      status: getString(pub, "document", "status"),
    },
    theme,
    footer: { text: footerText },
    includeOperationalProvenance: getBool(pub, false, "includeOperationalProvenance"),
    outputDir: getString(pub, "outputDir") || DEFAULT_PUBLICATION_CONFIG.outputDir,
  };
}
