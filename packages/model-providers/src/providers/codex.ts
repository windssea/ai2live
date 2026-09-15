import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { ProviderBinaryMissingError, ProviderNotConfiguredError } from "../errors.js";
import { codexBin, isDryRun } from "../env.js";
import { dryRunChat } from "../openai-compat/dry-run.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ImageEditRequest,
  ModelProvider,
} from "../types.js";

export interface CodexRunOptions {
  /** Working directory for the Codex process (project workspace). */
  cwd?: string;
  /** Override binary path (tests). */
  bin?: string;
  /** Injected runner for unit tests. */
  runCommand?: (
    bin: string,
    args: string[],
    opts: { cwd?: string; input: string }
  ) => Promise<{ stdout: string; stderr: string; code: number }>;
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
  opts: { cwd?: string; input: string }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    child.stdin?.write(opts.input);
    child.stdin?.end();
  });
}

/**
 * Local Codex adapter — shells out to a Codex CLI; does NOT call OpenAI cloud by default.
 * Design: later this can drive a local agent that edits the project / runs tools.
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

      const prompt = req.messages
        .map((m) => `[${m.role}]\n${m.content}`)
        .join("\n\n");

      const args = ["exec", "--skip-git-repo-check"];
      const run = opts.runCommand ?? defaultRunCommand;
      let result: { stdout: string; stderr: string; code: number };
      try {
        result = await run(bin, args, {
          cwd: opts.cwd ? path.resolve(opts.cwd) : undefined,
          input: prompt,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
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
        raw: { code: result.code, stderr: result.stderr },
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
