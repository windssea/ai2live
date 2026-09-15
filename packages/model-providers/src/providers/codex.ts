import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { ProviderBinaryMissingError, ProviderNotConfiguredError } from "../errors.js";
import {
  codexBin,
  codexCwd,
  codexTimeoutMs,
  isDryRun,
  parseCodexExtraArgs,
} from "../env.js";
import { dryRunChat } from "../openai-compat/dry-run.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ImageEditRequest,
  ModelProvider,
} from "../types.js";

export type CodexInvocationStyle = "exec" | "stdin_dash" | "prompt_arg";

export interface CodexRunOptions {
  /** Working directory for the Codex process (project workspace). */
  cwd?: string;
  /** Override binary path (tests). */
  bin?: string;
  /** Extra argv (overrides / merges with AI2LIVE_CODEX_ARGS). */
  extraArgs?: string[];
  /** Timeout in ms (default AI2LIVE_CODEX_TIMEOUT_MS or 120000). */
  timeoutMs?: number;
  /** Preferred invocation style (default: exec). */
  style?: CodexInvocationStyle;
  /** Injected runner for unit tests. */
  runCommand?: (
    bin: string,
    args: string[],
    opts: { cwd?: string; input: string; timeoutMs: number }
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
}

export interface BuildCodexArgvOptions {
  style?: CodexInvocationStyle;
  extraArgs?: string[];
  /** When style is prompt_arg, include the prompt as a trailing arg. */
  prompt?: string;
}

/**
 * Build argv for common Codex CLI patterns:
 * - exec: `codex exec --skip-git-repo-check` (+ extra) with prompt on stdin
 * - stdin_dash: `codex -` (+ extra) with prompt on stdin
 * - prompt_arg: `codex exec --skip-git-repo-check <prompt>` (+ extra)
 */
export function buildCodexArgv(opts: BuildCodexArgvOptions = {}): string[] {
  const style = opts.style ?? "exec";
  const extra = opts.extraArgs ?? parseCodexExtraArgs();
  if (style === "stdin_dash") {
    return ["-", ...extra];
  }
  if (style === "prompt_arg") {
    const base = ["exec", "--skip-git-repo-check", ...extra];
    if (opts.prompt !== undefined) base.push(opts.prompt);
    return base;
  }
  // default: exec subcommand; prompt via stdin
  return ["exec", "--skip-git-repo-check", ...extra];
}

async function looksExecutable(bin: string): Promise<boolean> {
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      await access(bin, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return new Promise((resolve) => {
    const child = spawn("which", [bin], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0 && out.trim().length > 0));
  });
}

function defaultRunCommand(
  bin: string,
  args: string[],
  opts: { cwd?: string; input: string; timeoutMs: number }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Codex timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    child.stdin?.write(opts.input);
    child.stdin?.end();
  });
}

function formatPrompt(req: ChatCompletionRequest): string {
  return req.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
}

/**
 * Local Codex adapter — shells out to a Codex CLI; does NOT call OpenAI cloud by default.
 * Probes common invocation patterns; prefers AI2LIVE_CODEX_BIN.
 */
export function createCodexProvider(opts: CodexRunOptions = {}): ModelProvider {
  const id = "codex" as const;
  const modelLabel = "codex-cli";

  return {
    id,
    async chat(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
      if (isDryRun()) {
        return dryRunChat(id, req.model ?? modelLabel, req);
      }

      const bin = opts.bin ?? codexBin();
      const available = await looksExecutable(bin);
      if (!available) {
        throw new ProviderBinaryMissingError(
          id,
          [
            `Codex binary not found: "${bin}".`,
            "Install OpenAI Codex CLI, or set AI2LIVE_CODEX_BIN to the executable path.",
            "Docs: docs/providers.md. Alternatively set AI2LIVE_MODEL_DRY_RUN=1.",
          ].join(" ")
        );
      }

      const prompt = formatPrompt(req);
      const style = opts.style ?? "exec";
      const extraArgs = opts.extraArgs ?? parseCodexExtraArgs();
      const args = buildCodexArgv({
        style,
        extraArgs,
        prompt: style === "prompt_arg" ? prompt : undefined,
      });
      const cwdRaw = opts.cwd ?? codexCwd();
      const cwd = cwdRaw ? path.resolve(cwdRaw) : undefined;
      const timeoutMs = opts.timeoutMs ?? codexTimeoutMs();
      const run = opts.runCommand ?? defaultRunCommand;

      let result: { stdout: string; stderr: string; code: number };
      try {
        result = await run(bin, args, {
          cwd,
          input: style === "prompt_arg" ? "" : prompt,
          timeoutMs,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/timed out/i.test(msg)) {
          throw new Error(`Codex timed out after ${timeoutMs}ms (AI2LIVE_CODEX_TIMEOUT_MS). ${msg}`);
        }
        throw new ProviderBinaryMissingError(
          id,
          `Failed to spawn Codex binary "${bin}": ${msg}. Set AI2LIVE_CODEX_BIN or install Codex CLI.`
        );
      }

      if (result.code !== 0 && !result.stdout.trim()) {
        throw new Error(
          `Codex exited with code ${result.code}: ${result.stderr.slice(0, 800) || "(no stderr)"}`
        );
      }

      return {
        provider: id,
        model: req.model ?? modelLabel,
        text: result.stdout.trim() || result.stderr.trim(),
        raw: { code: result.code, stderr: result.stderr, args, cwd, style },
      };
    },
    async imageEdit(_req: ImageEditRequest): Promise<{ outputPath: string }> {
      throw new ProviderNotConfiguredError(
        id,
        "Codex provider does not support imageEdit."
      );
    },
  };
}

/** Async probe used by diagnostics. */
export async function probeCodexConfigured(opts?: CodexRunOptions): Promise<boolean> {
  if (isDryRun()) return true;
  const bin = opts?.bin ?? codexBin();
  return looksExecutable(bin);
}
