import type { ProviderId } from "./types.js";

export function isDryRun(): boolean {
  return process.env.AI2LIVE_MODEL_DRY_RUN === "1" || process.env.AI2LIVE_MODEL_DRY_RUN === "true";
}

export function resolveProviderId(explicit?: ProviderId | string): ProviderId {
  const raw = (explicit ?? process.env.AI2LIVE_MODEL_PROVIDER ?? "grok").toLowerCase().trim();
  if (raw === "grok" || raw === "openai" || raw === "codex") return raw;
  throw new Error(
    `Unknown model provider "${raw}". Expected one of: grok, openai, codex (env AI2LIVE_MODEL_PROVIDER).`
  );
}

export function grokApiKey(): string | undefined {
  return process.env.AI2LIVE_GROK_API_KEY || process.env.XAI_API_KEY || undefined;
}

export function grokBaseUrl(): string {
  return (process.env.AI2LIVE_GROK_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, "");
}

export function grokDefaultModel(): string {
  return process.env.AI2LIVE_GROK_MODEL || "grok-2-latest";
}

export function openaiApiKey(): string | undefined {
  return process.env.AI2LIVE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || undefined;
}

export function openaiBaseUrl(): string {
  return (process.env.AI2LIVE_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

export function openaiDefaultModel(): string {
  return process.env.AI2LIVE_OPENAI_MODEL || "gpt-4o";
}

export function codexBin(): string {
  return process.env.AI2LIVE_CODEX_BIN || "codex";
}
