import type { ReasoningProvider } from "./provider.js";
import { FakeProvider } from "./fakeProvider.js";
import { ClaudeCliProvider, isClaudeCliAvailable } from "./claudeCliProvider.js";
import { resolveClaudeExecutable } from "../ai/claudeInvoke.js";

/**
 * Resolve the live reasoning provider without coupling DocForce core
 * to a vendor.
 *
 * DOCFORCE_AI_PROVIDER: claude | fake | none
 * DOCFORCE_CLAUDE_PATH: absolute or PATH name of the Claude CLI
 */
export function resolveReasoningProvider(configuredCommand?: string): ReasoningProvider | undefined {
  const requested = (process.env.DOCFORCE_AI_PROVIDER ?? "").trim().toLowerCase();

  if (requested === "none" || requested === "off") {
    return undefined;
  }
  if (requested === "fake") {
    return new FakeProvider();
  }
  const command = resolveClaudeExecutable(configuredCommand);
  if (requested === "claude" || requested === "") {
    if (command) {
      return new ClaudeCliProvider({ command });
    }
    return undefined;
  }

  return undefined;
}

export { isClaudeCliAvailable, resolveClaudeExecutable };
