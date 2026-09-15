#!/usr/bin/env node
/**
 * Lightweight local API for Studio — reads project files and spawns ai2live CLI.
 * Bind: 127.0.0.1 only. No auth (local MVP).
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const CLI_JS = path.join(REPO_ROOT, "apps/cli/dist/cli.js");
const PORT = Number(process.env.AI2LIVE_STUDIO_API_PORT || 5174);
const HOST = "127.0.0.1";

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function resolveProject(projectPath) {
  const p = path.resolve(projectPath || path.join(REPO_ROOT, "examples/simple-character"));
  if (!p.startsWith(REPO_ROOT) && process.env.AI2LIVE_STUDIO_ALLOW_ANY !== "1") {
    // Allow any absolute path on local machine for MVP when under home/workspace too
  }
  return p;
}

async function runCli(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_JS, ...args], {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  try {
    if (url.pathname === "/api/health") {
      return send(res, 200, { ok: true, service: "ai2live-studio-api", repo: REPO_ROOT });
    }

    if (url.pathname === "/api/defaults") {
      return send(res, 200, {
        exampleProject: path.join(REPO_ROOT, "examples/simple-character"),
        repoRoot: REPO_ROOT,
      });
    }

    if (url.pathname === "/api/project" && req.method === "GET") {
      const projectPath = resolveProject(url.searchParams.get("path"));
      const manPath = path.join(projectPath, "spec", "layer_manifest.json");
      const charPath = path.join(projectPath, "spec", "character.json");
      const reportPath = path.join(projectPath, "validation", "report.json");
      const segReport = path.join(projectPath, "masks", "segmentation_report.json");
      const settingsPath = path.join(projectPath, ".ai2live-studio.json");

      let manifest = null;
      let character = null;
      let validation = null;
      let segmentation = null;
      let settings = null;
      try {
        manifest = JSON.parse(await readFile(manPath, "utf8"));
      } catch (e) {
        return send(res, 404, { error: `No layer_manifest.json at ${manPath}` });
      }
      try {
        character = JSON.parse(await readFile(charPath, "utf8"));
      } catch {
        /* optional */
      }
      try {
        validation = JSON.parse(await readFile(reportPath, "utf8"));
      } catch {
        /* optional */
      }
      try {
        segmentation = JSON.parse(await readFile(segReport, "utf8"));
      } catch {
        /* optional */
      }
      try {
        settings = JSON.parse(await readFile(settingsPath, "utf8"));
      } catch {
        /* optional */
      }

      const previews = {
        master: path.join(projectPath, "design", "master_neutral.png"),
        recomposed: path.join(projectPath, "previews", "recomposed_neutral.png"),
        segDebug: path.join(projectPath, "previews", "seg_debug.png"),
      };
      const previewExists = {};
      for (const [k, p] of Object.entries(previews)) {
        try {
          await access(p);
          previewExists[k] = true;
        } catch {
          previewExists[k] = false;
        }
      }

      return send(res, 200, {
        projectPath,
        character,
        manifest,
        layers: manifest.layers ?? [],
        validation,
        segmentation,
        settings,
        previewExists,
        previewUrls: {
          master: previewExists.master
            ? `/api/file?path=${encodeURIComponent(previews.master)}`
            : null,
          recomposed: previewExists.recomposed
            ? `/api/file?path=${encodeURIComponent(previews.recomposed)}`
            : null,
          segDebug: previewExists.segDebug
            ? `/api/file?path=${encodeURIComponent(previews.segDebug)}`
            : null,
        },
      });
    }

    if (url.pathname === "/api/file" && req.method === "GET") {
      const filePath = path.resolve(url.searchParams.get("path") || "");
      try {
        await access(filePath);
      } catch {
        return send(res, 404, "not found");
      }
      const buf = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const type =
        ext === ".png"
          ? "image/png"
          : ext === ".json"
            ? "application/json"
            : "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      return res.end(buf);
    }

    if (url.pathname === "/api/settings" && req.method === "POST") {
      const body = await readJson(req);
      const projectPath = resolveProject(body.projectPath);
      const settingsPath = path.join(projectPath, ".ai2live-studio.json");
      const settings = {
        provider: body.provider ?? "grok",
        dryRun: Boolean(body.dryRun),
        updatedAt: new Date().toISOString(),
      };
      await writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return send(res, 200, { ok: true, settings, path: settingsPath });
    }

    if (url.pathname === "/api/run" && req.method === "POST") {
      const body = await readJson(req);
      const projectPath = resolveProject(body.projectPath);
      const action = body.action;
      const provider = body.provider;
      const dryRun = Boolean(body.dryRun);
      const extra = body.extra ?? {};

      try {
        await access(CLI_JS);
      } catch {
        return send(res, 500, {
          error: `CLI not built: ${CLI_JS}. Run pnpm -r build first.`,
        });
      }

      const envPatch = { ...process.env };
      if (provider) envPatch.AI2LIVE_MODEL_PROVIDER = provider;
      if (dryRun) envPatch.AI2LIVE_MODEL_DRY_RUN = "1";
      else delete envPatch.AI2LIVE_MODEL_DRY_RUN;

      let args = [];
      switch (action) {
        case "compile":
          args = ["compile", projectPath];
          break;
        case "validate":
          args = ["validate", projectPath];
          break;
        case "segment":
          args = ["segment", projectPath];
          if (extra.feather) args.push("--feather", String(extra.feather));
          if (extra.splitBilateral) args.push("--split-bilateral");
          if (extra.debug !== false) args.push("--debug");
          break;
        case "doctor":
          args = ["doctor"];
          break;
        case "providers":
          args = ["providers"];
          break;
        default:
          return send(res, 400, { error: `Unknown action: ${action}` });
      }

      const result = await new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI_JS, ...args], {
          cwd: REPO_ROOT,
          env: envPatch,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      });

      let validation = null;
      try {
        validation = JSON.parse(
          await readFile(path.join(projectPath, "validation", "report.json"), "utf8")
        );
      } catch {
        /* optional */
      }

      return send(res, 200, { ...result, validation, action, projectPath });
    }

    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: (err && err.message) || String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ai2live studio API http://${HOST}:${PORT}`);
});
