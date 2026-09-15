import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildCodexArgv,
  createCodexProvider,
  parseCodexExtraArgs,
  createProvider,
} from "./index.js";

const ENV_KEYS = [
  "AI2LIVE_MODEL_DRY_RUN",
  "AI2LIVE_CODEX_BIN",
  "AI2LIVE_CODEX_ARGS",
  "AI2LIVE_CODEX_CWD",
  "AI2LIVE_CODEX_TIMEOUT_MS",
] as const;

describe("parseCodexExtraArgs", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("parses JSON array", () => {
    expect(parseCodexExtraArgs('["--foo","bar"]')).toEqual(["--foo", "bar"]);
  });

  it("parses shell-split string", () => {
    expect(parseCodexExtraArgs("--model o3 --quiet")).toEqual(["--model", "o3", "--quiet"]);
  });

  it("respects double quotes in shell-split", () => {
    expect(parseCodexExtraArgs('--msg "hello world"')).toEqual(["--msg", "hello world"]);
  });

  it("reads from env when raw omitted", () => {
    process.env.AI2LIVE_CODEX_ARGS = '["-q"]';
    expect(parseCodexExtraArgs()).toEqual(["-q"]);
  });

  it("returns empty when unset", () => {
    expect(parseCodexExtraArgs()).toEqual([]);
  });
});

describe("buildCodexArgv", () => {
  it("defaults to exec --skip-git-repo-check", () => {
    expect(buildCodexArgv()).toEqual(["exec", "--skip-git-repo-check"]);
  });

  it("appends extra args for exec style", () => {
    expect(buildCodexArgv({ extraArgs: ["--foo"] })).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--foo",
    ]);
  });

  it("builds stdin_dash style", () => {
    expect(buildCodexArgv({ style: "stdin_dash", extraArgs: ["-q"] })).toEqual(["-", "-q"]);
  });

  it("builds prompt_arg style with prompt trailing", () => {
    expect(
      buildCodexArgv({ style: "prompt_arg", prompt: "hi", extraArgs: ["--x"] })
    ).toEqual(["exec", "--skip-git-repo-check", "--x", "hi"]);
  });
});

describe("createCodexProvider with mocked runCommand", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("passes exec argv, cwd, timeout, and stdin prompt", async () => {
    process.env.AI2LIVE_CODEX_ARGS = '["--sandbox","read-only"]';
    process.env.AI2LIVE_CODEX_TIMEOUT_MS = "5000";

    const runCommand = vi.fn(
      async (
        bin: string,
        args: string[],
        opts: { cwd?: string; input: string; timeoutMs: number }
      ) => {
        expect(bin).toBe("node");
        expect(args).toEqual(["exec", "--skip-git-repo-check", "--sandbox", "read-only"]);
        expect(opts.cwd).toBe("/tmp/workspace");
        expect(opts.input).toContain("[user]");
        expect(opts.input).toContain("fix layers");
        expect(opts.timeoutMs).toBe(5000);
        return { stdout: "ok from codex", stderr: "", code: 0 };
      }
    );

    const p = createProvider("codex", {
      codexBin: "node",
      cwd: "/tmp/workspace",
      codexRunCommand: runCommand,
    });

    const result = await p.chat({
      messages: [{ role: "user", content: "fix layers" }],
    });
    expect(result.text).toBe("ok from codex");
    expect(result.provider).toBe("codex");
    expect(runCommand).toHaveBeenCalledOnce();
  });

  it("uses AI2LIVE_CODEX_CWD when opts.cwd omitted", async () => {
    process.env.AI2LIVE_CODEX_CWD = "/tmp/from-env";
    let seenCwd: string | undefined;
    const p = createProvider("codex", {
      codexBin: "node",
      codexRunCommand: async (_bin, _args, opts) => {
        seenCwd = opts.cwd;
        return { stdout: "yes", stderr: "", code: 0 };
      },
    });
    await p.chat({ messages: [{ role: "user", content: "x" }] });
    expect(seenCwd).toBe("/tmp/from-env");
  });

  it("surfaces non-zero exit without stdout", async () => {
    const p = createProvider("codex", {
      codexBin: "node",
      codexRunCommand: async () => ({ stdout: "", stderr: "boom", code: 2 }),
    });
    await expect(p.chat({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      /Codex exited with code 2/
    );
  });

  it("dry-run still works without binary", async () => {
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
    const p = createCodexProvider({ bin: "/no/such/codex" });
    const r = await p.chat({
      messages: [{ role: "user", content: "hi" }],
      response_format: "json",
    });
    expect(JSON.parse(r.text).dry_run).toBe(true);
  });
});
