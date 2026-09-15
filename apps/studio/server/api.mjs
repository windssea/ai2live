#!/usr/bin/env node
/**
 * Local Studio API — project IO + unified pipeline (SSE / NDJSON).
 * Bind: 127.0.0.1 only. No auth (local MVP).
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { access, readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const CLI_JS = path.join(REPO_ROOT, "apps/cli/dist/cli.js");
const PIPELINE_JS = path.join(REPO_ROOT, "packages/pipeline/dist/index.js");
const PORT = Number(process.env.AI2LIVE_STUDIO_API_PORT || 5174);
const HOST = "127.0.0.1";

/** @type {{ abort?: AbortController, busy?: boolean }} */
const pipelineState = { busy: false };

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
  return path.resolve(projectPath || path.join(REPO_ROOT, "examples/simple-character"));
}

async function loadPipeline() {
  await access(PIPELINE_JS);
  return import(pathToFileURL(PIPELINE_JS).href);
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
        steps: [
          "bootstrap",
          "doctor",
          "segment",
          "occlusion",
          "expressions",
          "compile",
          "qc",
          "pose",
          "repair",
          "downstream",
          "report",
        ],
      });
    }

    if (url.pathname === "/api/project" && req.method === "GET") {
      const projectPath = resolveProject(url.searchParams.get("path"));
      const manPath = path.join(projectPath, "spec", "layer_manifest.json");
      const charPath = path.join(projectPath, "spec", "character.json");
      const reportPath = path.join(projectPath, "validation", "report.json");
      const pipelineReportPath = path.join(projectPath, "validation", "pipeline_report.json");
      const segReport = path.join(projectPath, "masks", "segmentation_report.json");
      const settingsPath = path.join(projectPath, ".ai2live-studio.json");

      let manifest = null;
      let character = null;
      let validation = null;
      let pipelineReport = null;
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
        pipelineReport = JSON.parse(await readFile(pipelineReportPath, "utf8"));
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

      const psdWorking = path.join(projectPath, "psd", "character.psd");
      let psdExport = null;
      try {
        const exportsDir = path.join(projectPath, "exports");
        const names = await readdir(exportsDir);
        const hit = names.find((n) => n.endsWith("_layers.psd") || n.endsWith(".psd"));
        if (hit) psdExport = path.join(exportsDir, hit);
      } catch {
        /* no exports yet */
      }
      if (!psdExport && pipelineReport?.artifacts?.psdExport) {
        psdExport = pipelineReport.artifacts.psdExport;
      }

      const artifactPaths = {
        psd: psdWorking,
        psdExport: psdExport,
        importManifest:
          pipelineReport?.artifacts?.importManifest ||
          path.join(projectPath, "exports", "import_manifest.json"),
        importManifestWorking: path.join(projectPath, "psd", "import_manifest.json"),
        autolive2d: path.join(projectPath, "builds", "autolive2d"),
        psd2live: path.join(projectPath, "builds", "psd2live"),
        pipelineReport: pipelineReportPath,
      };

      return send(res, 200, {
        projectPath,
        character,
        manifest,
        layers: manifest.layers ?? [],
        validation,
        pipelineReport,
        segmentation,
        settings,
        previewExists,
        artifactPaths,
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
      const asDownload =
        url.searchParams.get("download") === "1" ||
        url.searchParams.get("download") === "true";
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
            : ext === ".psd"
              ? "image/vnd.adobe.photoshop"
              : "application/octet-stream";
      /** @type {Record<string, string>} */
      const headers = {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      };
      if (asDownload) {
        const filename = path.basename(filePath).replace(/[\r\n"]/g, "_");
        headers["Content-Disposition"] = `attachment; filename="${filename}"`;
      }
      res.writeHead(200, headers);
      return res.end(buf);
    }

    if (url.pathname === "/api/settings" && req.method === "POST") {
      const body = await readJson(req);
      const projectPath = resolveProject(body.projectPath);
      await mkdir(projectPath, { recursive: true });
      const settingsPath = path.join(projectPath, ".ai2live-studio.json");
      const settings = {
        provider: body.provider ?? "grok",
        dryRun: Boolean(body.dryRun),
        skip: body.skip ?? {},
        updatedAt: new Date().toISOString(),
      };
      await writeFile(settingsPath, JSON.stringify(settings, null, 2));
      return send(res, 200, { ok: true, settings, path: settingsPath });
    }

    if (url.pathname === "/api/import-image" && req.method === "POST") {
      const body = await readJson(req);
      const projectPath = resolveProject(body.projectPath);
      const imagePath = body.imagePath ? path.resolve(body.imagePath) : null;
      const imageBase64 = body.imageBase64;
      if (!imagePath && !imageBase64) {
        return send(res, 400, { error: "Provide imagePath or imageBase64" });
      }
      await mkdir(path.join(projectPath, "design"), { recursive: true });
      const destMaster = path.join(projectPath, "design", "master_neutral.png");
      const destRef = path.join(projectPath, "design", "reference.png");
      if (imageBase64) {
        const raw = String(imageBase64).replace(/^data:image\/\w+;base64,/, "");
        const buf = Buffer.from(raw, "base64");
        await writeFile(destMaster, buf);
        await writeFile(destRef, buf);
      } else {
        await access(imagePath);
        await copyFile(imagePath, destMaster);
        await copyFile(imagePath, destRef);
      }
      return send(res, 200, {
        ok: true,
        projectPath,
        masterPath: destMaster,
        referencePath: destRef,
        fromImage: destMaster,
      });
    }

    if (url.pathname === "/api/pipeline/cancel" && req.method === "POST") {
      if (pipelineState.abort) {
        pipelineState.abort.abort();
        return send(res, 200, { ok: true, cancelled: true });
      }
      return send(res, 200, { ok: true, cancelled: false });
    }

    if (url.pathname === "/api/pipeline" && req.method === "POST") {
      if (pipelineState.busy) {
        return send(res, 409, { error: "Pipeline already running" });
      }
      const body = await readJson(req);
      const projectPath = resolveProject(body.projectPath);
      const provider = body.provider ?? "grok";
      const dryRun = Boolean(body.dryRun);
      const fromImage = body.fromImage ? path.resolve(body.fromImage) : undefined;
      const skip = { ...(body.skip ?? {}) };
      // Compile is a first-class deliverable — never skippable from Studio Run All
      delete skip.compile;
      const stream = body.stream !== false;

      const envPatch = { ...process.env };
      envPatch.AI2LIVE_MODEL_PROVIDER = provider;
      if (dryRun) envPatch.AI2LIVE_MODEL_DRY_RUN = "1";
      else delete envPatch.AI2LIVE_MODEL_DRY_RUN;

      // Prefer in-process pipeline
      let useInProcess = true;
      try {
        await access(PIPELINE_JS);
      } catch {
        useInProcess = false;
      }

      if (stream) {
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Transfer-Encoding": "chunked",
        });
      }

      const writeEvent = (e) => {
        if (stream) {
          res.write(JSON.stringify(e) + "\n");
        }
      };

      pipelineState.busy = true;
      pipelineState.abort = new AbortController();

      try {
        if (useInProcess) {
          // Apply env for doctor / providers inside process
          Object.assign(process.env, envPatch);
          const { runFullPipeline } = await loadPipeline();
          const result = await runFullPipeline({
            projectRoot: projectPath,
            provider,
            dryRun,
            fromImage,
            characterName: body.characterName,
            skip,
            alwaysRepair: Boolean(body.alwaysRepair),
            signal: pipelineState.abort.signal,
            onEvent: writeEvent,
          });
          if (!stream) {
            return send(res, 200, result);
          }
          res.end();
        } else {
          // Fallback: spawn CLI with --json-events
          try {
            await access(CLI_JS);
          } catch {
            if (stream) {
              writeEvent({
                type: "error",
                message: `CLI not built: ${CLI_JS}. Run pnpm -r build first.`,
              });
              res.end();
              return;
            }
            return send(res, 500, { error: `CLI not built: ${CLI_JS}` });
          }
          const args = ["run", projectPath, "--json-events"];
          if (provider) args.push("--provider", provider);
          if (dryRun) args.push("--dry-run");
          if (fromImage) args.push("--from-image", fromImage);
          if (body.characterName) args.push("--name", body.characterName);
          if (skip.segment) args.push("--skip-segment");
          if (skip.repair) args.push("--skip-repair");
          if (skip.occlusion) args.push("--skip-occlusion");
          if (skip.expressions) args.push("--skip-expressions");
          if (skip.downstream) args.push("--skip-downstream");

          await new Promise((resolve) => {
            const child = spawn(process.execPath, [CLI_JS, ...args], {
              cwd: REPO_ROOT,
              env: envPatch,
              stdio: ["ignore", "pipe", "pipe"],
            });
            const onAbort = () => child.kill("SIGTERM");
            pipelineState.abort.signal.addEventListener("abort", onAbort);
            child.stdout.on("data", (d) => {
              if (stream) res.write(d);
            });
            child.stderr.on("data", (d) => {
              if (stream) {
                writeEvent({ type: "log", message: d.toString() });
              }
            });
            child.on("close", () => {
              pipelineState.abort.signal.removeEventListener("abort", onAbort);
              resolve();
            });
          });
          if (stream) res.end();
          else send(res, 200, { ok: true });
        }
      } catch (err) {
        const message = (err && err.message) || String(err);
        if (stream) {
          writeEvent({ type: "error", message });
          writeEvent({ type: "done", message });
          res.end();
        } else {
          send(res, 500, { error: message });
        }
      } finally {
        pipelineState.busy = false;
        pipelineState.abort = undefined;
      }
      return;
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
        case "run":
        case "pipeline":
          args = ["run", projectPath, "--dry-run"];
          if (provider) args.push("--provider", provider);
          if (dryRun) args.push("--dry-run");
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
