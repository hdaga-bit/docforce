import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { LanguageInfo, TechnologyInfo, Evidence, Provenance } from "../model/types.js";

export interface TsconfigFindings {
  languages: LanguageInfo[];
  technologies: TechnologyInfo[];
}

interface TsConfig {
  compilerOptions?: {
    target?: string;
    module?: string;
    moduleResolution?: string;
    strict?: boolean;
    outDir?: string;
    rootDir?: string;
    jsx?: string;
    [key: string]: unknown;
  };
  extends?: string;
  include?: string[];
  exclude?: string[];
}

function obs(sourceFile: string, detail: string): Provenance {
  const evidence: Evidence[] = [{ sourceFile, evidenceType: "tsconfig-field", detail }];
  return { kind: "observation", confidence: "high", evidence };
}

export function scanTsconfig(repoRoot: string): TsconfigFindings {
  const result: TsconfigFindings = { languages: [], technologies: [] };

  for (const filename of ["tsconfig.json", "tsconfig.build.json"]) {
    const filePath = resolve(repoRoot, filename);
    if (!existsSync(filePath)) continue;

    let tsconfig: TsConfig;
    try {
      const raw = readFileSync(filePath, "utf-8");
      tsconfig = JSON.parse(raw) as TsConfig;
    } catch {
      continue;
    }

    const opts = tsconfig.compilerOptions;
    if (!opts) continue;

    if (filename === "tsconfig.json") {
      if (opts.target) {
        result.languages.push({
          name: "ECMAScript",
          version: opts.target,
          provenance: obs(filename, `compilerOptions.target = "${opts.target}"`),
        });
      }

      if (opts.module) {
        result.technologies.push({
          name: `Module System: ${opts.module}`,
          category: "language-config",
          purpose: `TypeScript module resolution: ${opts.moduleResolution ?? opts.module}`,
          provenance: obs(filename, `compilerOptions.module = "${opts.module}"`),
        });
      }

      if (opts.strict === true) {
        result.technologies.push({
          name: "TypeScript Strict Mode",
          category: "language-config",
          purpose: "All strict type-checking options enabled",
          provenance: obs(filename, `compilerOptions.strict = true`),
        });
      }

      if (opts.jsx) {
        result.technologies.push({
          name: "JSX",
          category: "language-config",
          purpose: `JSX transform: ${opts.jsx}`,
          provenance: obs(filename, `compilerOptions.jsx = "${opts.jsx}"`),
        });
      }
    }

    if (filename === "tsconfig.build.json" && tsconfig.extends) {
      result.technologies.push({
        name: "Separate Build Config",
        category: "tooling",
        purpose: `Build excludes test files (extends ${tsconfig.extends})`,
        provenance: obs(filename, `extends: "${tsconfig.extends}"`),
      });
    }
  }

  return result;
}
