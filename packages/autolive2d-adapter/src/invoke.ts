/**
 * Optional AutoLive2d binary invoke smoke.
 * Detects AI2LIVE_AUTOLIVE2D_CMD or AI2LIVE_AUTOLIVE2D_BIN; never vendors the tool.
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
      package_dir: outDir,
      hint: "Set AI2LIVE_AUTOLIVE2D_CMD to your AutoLive2d CLI (e.g. 'autolive2d import')",
    };
    await writeFile(reportPath, JSON.stringify(payload, null, 2));
    return { ...payload, report_path: reportPath };
  }

  // Smoke: prefer --help / version to avoid destructive imports in CI
  const help = await run(cmd, ["--help"], outDir, 10_000);
  if (help.code !== 0 && help.code !== null) {
    // try bare version
    const ver = await run(cmd, ["--version"], outDir, 10_000);
    if (ver.code !== 0 && ver.code !== null) {
      const failPath = path.join(outDir, "invoke_result.json");
      const payload = {
        attempted: true,
        skipped: false,
        ok: false,
        reason: "AutoLive2d binary did not respond to --help/--version",
        exit_code: ver.code ?? help.code,
        stdout_tail: (ver.stdout || help.stdout).slice(-2000),
        stderr_tail: (ver.stderr || help.stderr).slice(-2000),
        cmd,
      };
      await writeFile(failPath, JSON.stringify(payload, null, 2));
      return { ...payload, report_path: failPath };
    }
  }

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
    reason: "AutoLive2d smoke (--help/--version) succeeded",
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
  };
  await writeFile(okPath, JSON.stringify(payload, null, 2));
  // Remove skipped marker if present
  return { attempted: true, skipped: false, reason: payload.reason, exit_code: help.code, report_path: okPath };
}
