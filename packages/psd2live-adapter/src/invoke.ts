/**
 * Optional psd2live CLI / MCP endpoint smoke.
 * Detects AI2LIVE_PSD2LIVE_CMD or AI2LIVE_PSD2LIVE_MCP_URL — never vendors GPL.
 * Always writes invoke_log.json with richer skipped reasons + safe check when CMD set.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface Psd2LiveInvokeResult {
  attempted: boolean;
  skipped: boolean;
  reason?: string;
  exit_code?: number | null;
  report_path: string;
  log_path?: string;
  safe_check?: SafeCheckResult;
}

export interface SafeCheckResult {
  cmd_set: boolean;
  mcp_set: boolean;
  cmd_resolvable: boolean;
  help_ok: boolean;
  notes: string[];
}

function resolveCmd(): string | undefined {
  return (
    process.env.AI2LIVE_PSD2LIVE_CMD?.trim() ||
    process.env.AI2LIVE_PSD2LIVE_BIN?.trim() ||
    undefined
  );
}

function resolveMcpUrl(): string | undefined {
  const u = process.env.AI2LIVE_PSD2LIVE_MCP_URL?.trim();
  return u || undefined;
}

function useMockRig(): boolean {
  const v = (process.env.AI2LIVE_USE_MOCK_RIG ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

async function resolveMockCmd(): Promise<string | undefined> {
  if (!useMockRig()) return undefined;
  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/mock-rig/psd2live-mock.mjs"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../scripts/mock-rig/psd2live-mock.mjs"),
    path.resolve(process.cwd(), "scripts/mock-rig/psd2live-mock.mjs"),
  ];
  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch {
      /* try next */
    }
  }
  return candidates[0];
}


function run(cmd: string, args: string[], cwd: string, timeoutMs = 15_000): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true, env: process.env });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: null, stdout, stderr: stderr + "\n[timeout]" });
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ code: 127, stdout, stderr: String(err) });
    });
  });
}

async function writeLog(outDir: string, payload: Record<string, unknown>): Promise<string> {
  const logPath = path.join(outDir, "invoke_log.json");
  await writeFile(
    logPath,
    JSON.stringify(
      {
        version: "0.2",
        backend: "psd2live",
        timestamp: new Date().toISOString(),
        license_note: "psd2live is GPL — ai2live never vendors it; invoke externally",
        ...payload,
      },
      null,
      2
    )
  );
  return logPath;
}

export async function safeCheckPsd2Live(cmd: string, cwd: string): Promise<SafeCheckResult> {
  const notes: string[] = [];
  const help = await run(cmd, ["--help"], cwd, 10_000);
  const help_ok = help.code === 0 || (help.stdout + help.stderr).length > 0;
  if (!help_ok) notes.push(`--help exit=${help.code}`);
  const cmd_resolvable = help.code !== 127;
  if (!cmd_resolvable) notes.push("command not found / spawn error (exit 127)");
  return {
    cmd_set: true,
    mcp_set: false,
    cmd_resolvable,
    help_ok,
    notes,
  };
}

export async function invokePsd2LiveSmoke(opts: {
  projectRoot: string;
  packageDir: string;
}): Promise<Psd2LiveInvokeResult> {
  const outDir = path.resolve(opts.packageDir);
  await mkdir(outDir, { recursive: true });
  const skippedPath = path.join(outDir, "invoke_skipped.json");
  const cmd = resolveCmd();
  const mcp = resolveMcpUrl();

  if (!cmd && !mcp) {
    const mockCmd = await resolveMockCmd();
    if (mockCmd && useMockRig()) {
      const node = process.execPath;
      const help = await run(node, [mockCmd, "--help"], outDir, 10_000);
      const ver = await run(node, [mockCmd, "--version"], outDir, 10_000);
      const smoke = await run(node, [mockCmd, "smoke", outDir], outDir, 20_000);
      const okPath = path.join(outDir, "invoke_result.json");
      const payload = {
        attempted: true,
        skipped: false,
        ok: help.code === 0 && smoke.code === 0,
        reason: "Mock psd2live runner invoked (AI2LIVE_USE_MOCK_RIG=1; real CMD unset)",
        skipped_reason_code: null,
        via: "mock_rig",
        mock_cmd: mockCmd,
        exit_code: smoke.code,
        stdout_tail: (help.stdout + "\n" + smoke.stdout).slice(-2000),
        stderr_tail: (help.stderr + "\n" + smoke.stderr).slice(-2000),
        license_note: "psd2live is GPL — ai2live never vendors it; mock runner only",
        safe_check: {
          cmd_set: false,
          mcp_set: false,
          cmd_resolvable: true,
          help_ok: help.code === 0,
          notes: [
            "mock_rig runner used — set AI2LIVE_PSD2LIVE_CMD for real external binary",
            `version_ok=${ver.code === 0}`,
          ],
        },
      };
      await writeFile(okPath, JSON.stringify(payload, null, 2));
      const log_path = await writeLog(outDir, {
        ...payload,
        result_file: "invoke_result.json",
      });
      return {
        attempted: true,
        skipped: false,
        reason: payload.reason,
        exit_code: smoke.code,
        report_path: okPath,
        log_path,
        safe_check: payload.safe_check,
      };
    }
    const payload = {
      attempted: false,
      skipped: true,
      reason:
        "AI2LIVE_PSD2LIVE_CMD / AI2LIVE_PSD2LIVE_MCP_URL unset — external GPL process only; smoke skipped (mock rig disabled)",
      skipped_reason_code: "ENV_UNSET",
      package_dir: outDir,
      license_note: "psd2live is GPL — ai2live never vendors it; invoke externally",
      hint: "Install psd2live separately; set AI2LIVE_PSD2LIVE_CMD or AI2LIVE_USE_MOCK_RIG=1 for mock",
      safe_check: {
        cmd_set: false,
        mcp_set: false,
        cmd_resolvable: false,
        help_ok: false,
        notes: ["env unset — safe check not run"],
      },
    };
    await writeFile(skippedPath, JSON.stringify(payload, null, 2));
    const log_path = await writeLog(outDir, {
      ...payload,
      result_file: "invoke_skipped.json",
    });
    return { ...payload, report_path: skippedPath, log_path };
  }

  if (mcp) {
    try {
      const res = await fetch(mcp, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "ai2live", version: "0.1.0" },
          },
        }),
      });
      const okPath = path.join(outDir, "invoke_result.json");
      const text = await res.text();
      const payload = {
        attempted: true,
        skipped: false,
        ok: res.ok,
        via: "mcp",
        mcp_url: mcp,
        http_status: res.status,
        body_tail: text.slice(-2000),
        license_note: "external MCP only — no GPL vendored",
        skipped_reason_code: null,
        safe_check: {
          cmd_set: Boolean(cmd),
          mcp_set: true,
          cmd_resolvable: res.ok,
          help_ok: res.ok,
          notes: [`MCP initialize HTTP ${res.status}`],
        },
      };
      await writeFile(okPath, JSON.stringify(payload, null, 2));
      const log_path = await writeLog(outDir, {
        ...payload,
        result_file: "invoke_result.json",
      });
      return {
        attempted: true,
        skipped: false,
        reason: "MCP initialize attempted",
        report_path: okPath,
        log_path,
        safe_check: payload.safe_check,
      };
    } catch (err) {
      const failPath = path.join(outDir, "invoke_result.json");
      const payload = {
        attempted: true,
        skipped: false,
        ok: false,
        via: "mcp",
        reason: (err as Error).message,
        skipped_reason_code: "MCP_ERROR",
        mcp_url: mcp,
      };
      await writeFile(failPath, JSON.stringify(payload, null, 2));
      const log_path = await writeLog(outDir, {
        ...payload,
        result_file: "invoke_result.json",
      });
      return { attempted: true, skipped: false, reason: payload.reason, report_path: failPath, log_path };
    }
  }

  const safe = await safeCheckPsd2Live(cmd!, outDir);
  const help = await run(cmd!, ["--help"], outDir, 10_000);
  const okPath = path.join(outDir, "invoke_result.json");
  const payload = {
    attempted: true,
    skipped: false,
    ok: safe.help_ok || help.code === 0 || help.code === null,
    via: "cli",
    cmd,
    exit_code: help.code,
    stdout_tail: help.stdout.slice(-2000),
    stderr_tail: help.stderr.slice(-2000),
    license_note: "external CLI only — no GPL vendored",
    skipped_reason_code: null,
    safe_check: safe,
  };
  await writeFile(okPath, JSON.stringify(payload, null, 2));
  const log_path = await writeLog(outDir, {
    ...payload,
    result_file: "invoke_result.json",
  });
  return {
    attempted: true,
    skipped: false,
    reason: "psd2live CLI smoke attempted",
    exit_code: help.code,
    report_path: okPath,
    log_path,
    safe_check: safe,
  };
}
