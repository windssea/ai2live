import { resolveProviderId, isDryRun, grokApiKey, openaiApiKey, codexBin, grokDefaultModel, openaiDefaultModel } from "./env.js";
import { createGrokProvider, isGrokConfigured } from "./providers/grok.js";
import { createOpenAIProvider, isOpenAIConfigured } from "./providers/openai.js";
import { createCodexProvider } from "./providers/codex.js";
import type { ModelProvider, ProviderId, ProviderInfo } from "./types.js";
import { execFileSync } from "node:child_process";

export type { ProviderId, ProviderInfo };

export interface CreateProviderOptions {
  /** Optional cwd for Codex local agent workspace. */
  cwd?: string;
  /** Inject fetch for OpenAI-compat providers (tests). */
  fetchImpl?: typeof fetch;
  /** Override Codex binary (tests). */
  codexBin?: string;
  /** Inject Codex runner (tests). */
  codexRunCommand?: (
    bin: string,
    args: string[],
    opts: { cwd?: string; input: string }
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
}

function whichSync(bin: string): boolean {
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      execFileSync("test", ["-x", bin], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isCodexConfiguredSync(binOverride?: string): boolean {
  if (isDryRun()) return true;
  return whichSync(binOverride ?? codexBin());
}

/**
 * Resolve active provider id from explicit arg or AI2LIVE_MODEL_PROVIDER (default: grok).
 */
export { resolveProviderId };

/**
 * Create a model provider by id. Default id comes from resolveProviderId().
 */
export function createProvider(
  id?: ProviderId | string,
  opts: CreateProviderOptions = {}
): ModelProvider {
  const resolved = resolveProviderId(id);
  switch (resolved) {
    case "grok":
      return createGrokProvider({ fetchImpl: opts.fetchImpl });
    case "openai":
      return createOpenAIProvider({ fetchImpl: opts.fetchImpl });
    case "codex":
      return createCodexProvider({
        cwd: opts.cwd,
        bin: opts.codexBin,
        runCommand: opts.codexRunCommand,
      });
    default: {
      const _exhaustive: never = resolved;
      throw new Error(`Unhandled provider: ${_exhaustive}`);
    }
  }
}

/**
 * List known providers and whether they look configured for use.
 * Grok/OpenAI: API key present OR dry-run.
 * Codex: binary on PATH (or AI2LIVE_CODEX_BIN) OR dry-run.
 */
export function listProviders(opts: CreateProviderOptions = {}): ProviderInfo[] {
  return [
    {
      id: "grok",
      configured: isGrokConfigured(),
      kind: "openai-compat (xAI)",
      defaultModel: grokDefaultModel(),
    },
    {
      id: "openai",
      configured: isOpenAIConfigured(),
      kind: "openai-compat (ChatGPT)",
      defaultModel: openaiDefaultModel(),
    },
    {
      id: "codex",
      configured: isCodexConfiguredSync(opts.codexBin),
      kind: "local-cli",
      defaultModel: "codex-cli",
    },
  ];
}

/** Exposed for tests / diagnostics */
export function providerConfigured(id: ProviderId): boolean {
  switch (id) {
    case "grok":
      return isGrokConfigured();
    case "openai":
      return isOpenAIConfigured();
    case "codex":
      return isCodexConfiguredSync();
    default:
      return false;
  }
}

export { isDryRun, grokApiKey, openaiApiKey };
