/**
 * Optional psd2live CLI / MCP endpoint smoke.
 * Detects AI2LIVE_PSD2LIVE_CMD or AI2LIVE_PSD2LIVE_MCP_URL — never vendors GPL.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export interface Psd2LiveInvokeResult {
  attempted: boolean;
  skipped: boolean;
  reason?: string;
  exit_code?: number | null;
  report_path: string;
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
    const payload = {
      attempted: false,
      skipped: true,
      reason:
        "AI2LIVE_PSD2LIVE_CMD / AI2LIVE_PSD2LIVE_MCP_URL unset — external GPL process only; smoke skipped",
      package_dir: outDir,
      license_note: "psd2live is GPL — ai2live never vendors it; invoke externally",
      hint: "Install psd2live separately; set AI2LIVE_PSD2LIVE_CMD or AI2LIVE_PSD2LIVE_MCP_URL",
    };
    await writeFile(skippedPath, JSON.stringify(payload, null, 2));
    return { ...payload, report_path: skippedPath };
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
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ai2live", version: "0.1.0" } },
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
      };
      await writeFile(okPath, JSON.stringify(payload, null, 2));
      return { attempted: true, skipped: false, reason: "MCP initialize attempted", report_path: okPath };
    } catch (err) {
      const failPath = path.join(outDir, "invoke_result.json");
      const payload = {
        attempted: true,
        skipped: false,
        ok: false,
        via: "mcp",
        reason: (err as Error).message,
        mcp_url: mcp,
      };
      await writeFile(failPath, JSON.stringify(payload, null, 2));
      return { attempted: true, skipped: false, reason: payload.reason, report_path: failPath };
    }
  }

  const help = await run(cmd!, ["--help"], outDir, 10_000);
  const okPath = path.join(outDir, "invoke_result.json");
  const payload = {
    attempted: true,
    skipped: false,
    ok: help.code === 0 || help.code === null,
    via: "cli",
    cmd,
    exit_code: help.code,
    stdout_tail: help.stdout.slice(-2000),
    stderr_tail: help.stderr.slice(-2000),
    license_note: "external CLI only — no GPL vendored",
  };
  await writeFile(okPath, JSON.stringify(payload, null, 2));
  return {
    attempted: true,
    skipped: false,
    reason: "psd2live CLI smoke attempted",
    exit_code: help.code,
    report_path: okPath,
  };
}
