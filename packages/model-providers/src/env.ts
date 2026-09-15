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

export function openaiImageModel(): string {
  return process.env.AI2LIVE_OPENAI_IMAGE_MODEL || "dall-e-2";
}

export function grokImageModel(): string {
  return process.env.AI2LIVE_GROK_IMAGE_MODEL || process.env.AI2LIVE_GROK_MODEL || "grok-2-latest";
}

export function codexBin(): string {
  return process.env.AI2LIVE_CODEX_BIN || "codex";
}

export function codexCwd(): string | undefined {
  const v = process.env.AI2LIVE_CODEX_CWD;
  return v && v.trim() ? v.trim() : undefined;
}

export function codexTimeoutMs(): number {
  const raw = process.env.AI2LIVE_CODEX_TIMEOUT_MS;
  if (!raw) return 120_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

/**
 * Parse AI2LIVE_CODEX_ARGS: JSON array preferred, else simple shell-ish split
 * (respects double quotes; no full shell expansion).
 */
export function parseCodexExtraArgs(raw?: string): string[] {
  const src = raw ?? process.env.AI2LIVE_CODEX_ARGS;
  if (!src || !src.trim()) return [];
  const trimmed = src.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return parsed as string[];
      }
      throw new Error("AI2LIVE_CODEX_ARGS JSON must be an array of strings");
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`AI2LIVE_CODEX_ARGS is not valid JSON: ${err.message}`);
      }
      throw err;
    }
  }
  return shellSplit(trimmed);
}

function shellSplit(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur.length) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length) out.push(cur);
  return out;
}
