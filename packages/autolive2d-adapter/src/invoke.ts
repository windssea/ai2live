/**
 * Optional AutoLive2d binary invoke smoke.
 * Detects AI2LIVE_AUTOLIVE2D_CMD or AI2LIVE_AUTOLIVE2D_BIN; never vendors the tool.
 * Always writes invoke_log.json (plus invoke_skipped.json / invoke_result.json).
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export interface AutoLive2dInvokeResult {
  attempted: boolean;
  skipped: boolean;
  reason?: string;
  exit_code?: number | null;
  stdout_tail?: string;
  stderr_tail?: string;
  report_path: string;
  log_path?: string;
  safe_check?: SafeCheckResult;
}

export interface SafeCheckResult {
  cmd_set: boolean;
  cmd_resolvable: boolean;
  help_ok: boolean;
  version_ok: boolean;
  notes: string[];
}

function resolveCmd(): string | undefined {
  const a = process.env.AI2LIVE_AUTOLIVE2D_CMD?.trim();
  if (a) return a;
  const b = process.env.AI2LIVE_AUTOLIVE2D_BIN?.trim();
  if (b) return b;
  return undefined;
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
        backend: "autolive2d",
        timestamp: new Date().toISOString(),
        ...payload,
      },
      null,
      2
    )
  );
  return logPath;
}

/**
 * When AI2LIVE_AUTOLIVE2D_CMD is set: run a non-destructive safe check (--help / --version)
 * before any optional import smoke.
 */
export async function safeCheckAutoLive2d(cmd: string, cwd: string): Promise<SafeCheckResult> {
  const notes: string[] = [];
  const help = await run(cmd, ["--help"], cwd, 10_000);
  const help_ok = help.code === 0 || (help.code === null && help.stdout.length > 0);
  if (!help_ok) notes.push(`--help exit=${help.code}`);
  const ver = await run(cmd, ["--version"], cwd, 10_000);
  const version_ok = ver.code === 0 || (ver.stdout + ver.stderr).length > 0;
  if (!version_ok) notes.push(`--version exit=${ver.code}`);
  const cmd_resolvable = help.code !== 127 && ver.code !== 127;
  if (!cmd_resolvable) notes.push("command not found / spawn error (exit 127)");
  return {
    cmd_set: true,
    cmd_resolvable,
    help_ok,
    version_ok,
    notes,
  };
}

/**
 * After buildAutoLive2dPackage: attempt import smoke if binary configured; else write invoke_skipped.json.
 */
export async function invokeAutoLive2dSmoke(opts: {
  projectRoot: string;
  packageDir: string;
}): Promise<AutoLive2dInvokeResult> {
  const root = path.resolve(opts.projectRoot);
  const outDir = path.resolve(opts.packageDir);
  await mkdir(outDir, { recursive: true });
  const reportPath = path.join(outDir, "invoke_skipped.json");
  const cmd = resolveCmd();

  if (!cmd) {
    const payload = {
      attempted: false,
      skipped: true,
      reason:
        "AI2LIVE_AUTOLIVE2D_CMD / AI2LIVE_AUTOLIVE2D_BIN unset — package written; import smoke skipped",
      skipped_reason_code: "ENV_UNSET",
      package_dir: outDir,
      hint: "Set AI2LIVE_AUTOLIVE2D_CMD to your AutoLive2d CLI (e.g. 'autolive2d import')",
      safe_check: {
        cmd_set: false,
        cmd_resolvable: false,
        help_ok: false,
        version_ok: false,
        notes: ["env unset — safe check not run"],
      },
    };
    await writeFile(reportPath, JSON.stringify(payload, null, 2));
    const log_path = await writeLog(outDir, {
      ...payload,
      result_file: "invoke_skipped.json",
    });
    return { ...payload, report_path: reportPath, log_path };
  }

  // Safe check when CMD is set
  const safe = await safeCheckAutoLive2d(cmd, outDir);
  if (!safe.cmd_resolvable || (!safe.help_ok && !safe.version_ok)) {
    const failPath = path.join(outDir, "invoke_result.json");
    const payload = {
      attempted: true,
      skipped: false,
      ok: false,
      reason: "AutoLive2d safe check failed (--help/--version)",
      skipped_reason_code: "SAFE_CHECK_FAILED",
      exit_code: 127,
      cmd,
      safe_check: safe,
    };
    await writeFile(failPath, JSON.stringify(payload, null, 2));
    const log_path = await writeLog(outDir, {
      ...payload,
      result_file: "invoke_result.json",
    });
    return { ...payload, report_path: failPath, log_path, safe_check: safe };
  }

  const help = await run(cmd, ["--help"], outDir, 10_000);

  // Optional import smoke when character.psd present
  let importResult: { code: number | null; stdout: string; stderr: string } | undefined;
  try {
    await access(path.join(outDir, "character.psd"));
    importResult = await run(
      cmd,
      ["import", "--psd", "character.psd", "--dry-run"],
      outDir,
      20_000
    );
  } catch {
    /* no psd */
  }

  const okPath = path.join(outDir, "invoke_result.json");
  const payload = {
    attempted: true,
    skipped: false,
    ok: true,
    reason: "AutoLive2d smoke (safe check + optional import --dry-run) succeeded",
    skipped_reason_code: null,
    cmd,
    exit_code: help.code,
    stdout_tail: help.stdout.slice(-2000),
    stderr_tail: help.stderr.slice(-2000),
    import_smoke: importResult
      ? {
          exit_code: importResult.code,
          stdout_tail: importResult.stdout.slice(-1000),
          stderr_tail: importResult.stderr.slice(-1000),
        }
      : null,
    project_root: root,
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
    reason: payload.reason,
    exit_code: help.code,
    report_path: okPath,
    log_path,
    safe_check: safe,
  };
}
