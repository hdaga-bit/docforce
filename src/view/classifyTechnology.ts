import type { DocforceConfig, TechnologyPresentation } from "../config/types.js";
import type { SystemModel, TechnologyInfo } from "../model/types.js";
import type { TechnologyViewItem } from "./types.js";
import { TECHNOLOGY_PRESENTATIONS } from "./types.js";

const CORE_PLATFORM = new Set(["next", "electron", "react-native", "@tauri-apps/api"]);

const FRAMEWORKS = new Set([
  "react",
  "react-dom",
  "express",
  "fastify",
  "flask",
  "django",
  "vue",
  "nuxt",
  "svelte",
  "nestjs",
  "@nestjs/core",
  "angular",
  "@angular/core",
]);

const LANGUAGE_RUNTIMES = new Set([
  "typescript",
  "python",
  "node",
  "nodejs",
  "node.js",
  "@types/node",
  "ts-node",
]);

const DATASTORES = new Set([
  "prisma",
  "@prisma/client",
  "pg",
  "postgres",
  "mysql2",
  "mysql",
  "mongodb",
  "mongoose",
  "redis",
  "ioredis",
  "@redis/client",
  "better-sqlite3",
  "sqlite3",
  "sql.js",
  "drizzle-orm",
  "typeorm",
  "knex",
  "sequelize",
  "firebase",
  "firebase-admin",
  "@google-cloud/firestore",
]);

const INFRASTRUCTURE = new Set([
  "docker",
  "docker-compose",
  "balena",
  "balena-cli",
  "kubernetes",
  "k8s",
  "systemd",
  "podman",
  "compose",
]);

const CAPABILITY_PATTERNS = [
  /^@?mediapipe([/-]|$)/i,
  /^jspdf$/i,
  /qrcode/i,
  /^@?paystack([/-]|$)/i,
  /^@?zoom([/-]|$)/i,
  /^stripe$/i,
  /^twilio$/i,
  /^openai$/i,
  /^@google\/generative-ai$/i,
  /^socket\.io$/i,
  /^zod$/i,
  /^joi$/i,
  /^yup$/i,
  /^valibot$/i,
  /^superstruct$/i,
  /^recharts$/i,
  /^chart\.js$/i,
  /^chartjs-/i,
  /^d3$/i,
  /^@visx\//i,
  /^victory$/i,
  /^@vercel\/analytics$/i,
  /^posthog-js$/i,
  /^@sentry\//i,
  /^mixpanel-browser$/i,
  /^litert-lm-api$/i,
  /^moonshine-voice$/i,
  /^kokoro-onnx$/i,
  /^soundfile$/i,
  /^librosa$/i,
  /^pydub$/i,
  /^pyserial$/i,
  /onnx/i,
];

const SUPPORTING_PREFIXES = [
  "@radix-ui/",
  "@hookform/",
  "@tailwindcss/",
];

const SUPPORTING_NAMES = new Set([
  "lucide-react",
  "lucide",
  "clsx",
  "tailwind-merge",
  "tailwindcss",
  "cmdk",
  "vaul",
  "embla-carousel-react",
  "embla-carousel",
  "sonner",
  "input-otp",
  "class-variance-authority",
  "next-themes",
  "react-day-picker",
  "react-hook-form",
  "autoprefixer",
  "postcss",
  "classnames",
  "framer-motion",
  "motion",
  "gsap",
  "@react-spring/web",
  "flask-cors",
  "tailwindcss-animate",
]);

const TOOLING_CATEGORIES = new Set(["tooling", "testing", "lint", "language-config"]);

export function isValidTechnologyPresentation(value: string): value is TechnologyPresentation {
  return (TECHNOLOGY_PRESENTATIONS as readonly string[]).includes(value);
}

export function classifyTechnology(
  tech: TechnologyInfo,
  model: SystemModel,
  config: DocforceConfig,
): TechnologyViewItem {
  const override = config.documentation.technologyOverrides?.[tech.name];
  const overridden = Boolean(override && isValidTechnologyPresentation(override.presentation));
  const presentation = overridden
    ? override!.presentation
    : classifyFromEvidence(tech, model);

  return {
    name: tech.name,
    version: tech.version,
    category: tech.category,
    purpose: tech.purpose,
    presentation,
    overridden,
    evidence: tech.provenance.evidence,
    confidence: tech.provenance.confidence,
  };
}

function classifyFromEvidence(tech: TechnologyInfo, model: SystemModel): TechnologyPresentation {
  const name = tech.name;
  const lower = name.toLowerCase();

  if (isDevelopmentTool(tech)) return "development-tool";
  if (isSupportingLibrary(name)) return "supporting-library";

  if (matchesDatastore(tech, model)) return "datastore";
  if (matchesIntegration(tech, model)) return "external-integration";

  if (
    tech.category === "containerization" ||
    tech.category === "device-fleet" ||
    INFRASTRUCTURE.has(lower)
  ) {
    return "infrastructure";
  }

  if (
    LANGUAGE_RUNTIMES.has(lower) ||
    tech.category === "language" ||
    model.languages.some((l) => l.name.toLowerCase() === lower) ||
    model.runtime.some((r) => r.name.toLowerCase() === lower)
  ) {
    return "language-runtime";
  }

  if (CORE_PLATFORM.has(lower)) return "core-platform";
  if (tech.category === "framework" || FRAMEWORKS.has(lower)) return "framework";

  if (CAPABILITY_PATTERNS.some((pattern) => pattern.test(name))) {
    return "capability-library";
  }

  if (tech.category === "validation") return "capability-library";

  if (lower.startsWith("firebase")) return "capability-library";

  return "unknown-dependency";
}

function isDevelopmentTool(tech: TechnologyInfo): boolean {
  if (tech.name.startsWith("@types/")) return true;
  if (TOOLING_CATEGORIES.has(tech.category)) return true;
  if (/eslint|prettier|typescript-eslint|^tsx$|^vitest$|^vite$/.test(tech.name)) return true;
  const hasRuntimeImport = tech.provenance.evidence.some((e) =>
    (e.evidenceType === "module-import" || e.evidenceType === "source-import")
    && Boolean(e.sourceFile)
    && !isTestSourceFile(e.sourceFile),
  );
  if (hasRuntimeImport) return false;
  if (tech.provenance.evidence.some((e) => e.evidenceType === "devDependency")) return true;
  return false;
}

function isTestSourceFile(sourceFile: string): boolean {
  return /(?:^|\/)(?:__tests__|test|tests|spec)\/|\.(?:test|spec)\.[jt]sx?$/.test(sourceFile);
}

function isSupportingLibrary(name: string): boolean {
  if (SUPPORTING_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return SUPPORTING_NAMES.has(name);
}

function matchesDatastore(tech: TechnologyInfo, model: SystemModel): boolean {
  if (DATASTORES.has(tech.name.toLowerCase()) || tech.category === "database") {
    if (tech.name.toLowerCase().startsWith("firebase")) {
      return model.datastores.some((ds) =>
        /firebase|firestore/i.test(`${ds.name} ${ds.engine ?? ""} ${ds.type}`),
      );
    }
    return true;
  }
  return model.datastores.some((ds) => {
    const haystack = `${ds.name} ${ds.engine ?? ""}`.toLowerCase();
    const engine = (ds.engine ?? "").toLowerCase();
    if (haystack.includes(tech.name.toLowerCase())) return true;
    if (engine.length > 0 && tech.name.toLowerCase().includes(engine)) return true;
    return false;
  });
}

function matchesIntegration(tech: TechnologyInfo, model: SystemModel): boolean {
  if (tech.category === "messaging") return true;
  const slug = tech.name.toLowerCase().replace(/^@/, "").split("/")[0] ?? tech.name;
  return model.integrations.some((integ) => {
    if (integ.type === "system") return false;
    const integName = integ.name.toLowerCase();
    return integName.includes(slug) || slug.includes(integName.split(" ")[0] ?? "");
  });
}

export function classifyTechnologies(
  model: SystemModel,
  config: DocforceConfig,
): TechnologyViewItem[] {
  return model.technologies.map((tech) => classifyTechnology(tech, model, config));
}
