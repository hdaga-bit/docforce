import type { DocforceConfig } from "../config/types.js";
import { DEFAULT_DOCS_OUTPUT } from "../config/types.js";
import { DEFAULT_PR_CONFIG } from "../config/index.js";

/** Fallback config for generators invoked without a consumer config. */
export function presentationConfig(config?: DocforceConfig): DocforceConfig {
  return config ?? {
    schemaVersion: "1.0.0",
    product: { name: "", type: "", description: "" },
    scanning: { rootDir: ".", include: [], exclude: [] },
    analysis: { exclude: [] },
    architecture: { components: {} },
    output: { systemModel: "", docs: DEFAULT_DOCS_OUTPUT },
    documentation: { allowedRoots: ["docs/"], aiAssisted: [] },
    ai: {},
    pr: DEFAULT_PR_CONFIG,
  };
}
