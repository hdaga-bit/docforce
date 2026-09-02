import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inferRepository, type InferOptions } from "./infer.js";
import { renderDocforceYaml } from "./yaml.js";

export interface InitOptions extends InferOptions {
  readonly yes?: boolean;
  readonly force?: boolean;
}

export interface InitResult {
  readonly wrote: boolean;
  readonly path: string;
  readonly existed: boolean;
  readonly productName: string;
  readonly include: readonly string[];
  readonly message: string;
}

export function runInit(options: InitOptions): InitResult {
  const repoRoot = resolve(options.repoRoot);
  const path = join(repoRoot, "docforce.yml");
  const existed = existsSync(path);
  if (existed && !options.force) {
    return {
      wrote: false,
      path,
      existed: true,
      productName: "",
      include: [],
      message: "DocForce configuration already exists.\nUse --force to overwrite (not recommended).",
    };
  }

  const inferred = inferRepository(options);
  writeFileSync(path, renderDocforceYaml(inferred.config), "utf-8");
  return {
    wrote: true,
    path,
    existed,
    productName: inferred.productName,
    include: inferred.include,
    message: [
      existed ? "Overwrote docforce.yml." : "Wrote starter docforce.yml.",
      `Product: ${inferred.productName}`,
      `Type: ${inferred.productType}`,
      `Include: ${inferred.include.join(", ")}`,
      inferred.description ? `Description: ${inferred.description}` : "Description: (empty — review and fill in)",
    ].join("\n"),
  };
}

export function formatInitReport(result: InitResult): string {
  return result.message;
}
