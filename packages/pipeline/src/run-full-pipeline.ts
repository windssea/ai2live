import { mkdir, writeFile, readFile, copyFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seeThroughFromMaster } from "@ai2live/segmentation";
import { completeOcclusionScenarios } from "@ai2live/occlusion";
import { generateExpressionDifferentials } from "@ai2live/expression";
import { compilePsd } from "@ai2live/psd-compiler";
import { runStaticQc } from "@ai2live/qc-engine";
import { renderPoseGridStub, diagnosePoseGrid } from "@ai2live/repair";
import { buildAutoLive2dPackage, invokeAutoLive2dSmoke } from "@ai2live/autolive2d-adapter";
import { writePsd2LiveDeepSession, invokePsd2LiveSmoke } from "@ai2live/psd2live-adapter";
import { writeHandoff } from "@ai2live/product";
import {
  createAgentContext,
  runRepairClosedLoop,
} from "@ai2live/agent-runtime";
import {
  runDoctor,
  resolveProviderId,
  formatDoctorReport,
  type ProviderId,
} from "@ai2live/model-providers";
import { bootstrapProjectFromImage, promoteSegmentDrafts } from "./bootstrap.js";
import { advanceFromPipelineStep } from "@ai2live/state-machine";
import type {
  PipelineEvent,
  PipelineResult,
  RunFullPipelineOptions,
  StepId,
  StepRecord,
} from "./types.js";

function emit(
  onEvent: ((e: PipelineEvent) => void) | undefined,
  e: PipelineEvent
): void {
  try {
    onEvent?.(e);
  } catch {
    /* ignore listener errors */
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("Pipeline aborted");
    err.name = "AbortError";
    throw err;
  }
}


function sanitizeExportSlug(raw: string): string {
  const slug = raw
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w\u4e00-\u9fff.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "");
  return slug || "character";
}

async function resolveExportSlug(
  root: string,
  characterName?: string
): Promise<string> {
  if (characterName?.trim()) return sanitizeExportSlug(characterName);
  try {
    const raw = JSON.parse(
      await readFile(path.join(root, "spec", "character.json"), "utf8")
    ) as { name?: string };
    if (raw.name?.trim()) return sanitizeExportSlug(raw.name);
  } catch {
    /* ignore */
  }
  return sanitizeExportSlug(path.basename(root));
}

async function exportPsdArtifacts(
  root: string,
  compiled: { psdPath: string; importManifestPath: string },
  characterName?: string
): Promise<{ psdExport: string; importManifestExport: string }> {
  const exportsDir = path.join(root, "exports");
  await mkdir(exportsDir, { recursive: true });
  const slug = await resolveExportSlug(root, characterName);
  const psdExport = path.join(exportsDir, `${slug}_layers.psd`);
  const importManifestExport = path.join(exportsDir, "import_manifest.json");
  await copyFile(compiled.psdPath, psdExport);
  await copyFile(compiled.importManifestPath, importManifestExport);
  return { psdExport, importManifestExport };
}



async function countSha256Assets(root: string): Promise<number> {
  const base = path.join(root, "assets", "sha256");
  let count = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && /\.(png|json|bin)$/i.test(e.name)) count += 1;
    }
  }
  await walk(base);
  return count;
}

function completionMethodHistogram(steps: StepRecord[]): Record<string, number> {
  const hist: Record<string, number> = {};
  const bump = (m: string) => {
    hist[m] = (hist[m] ?? 0) + 1;
  };
  for (const s of steps) {
    const data = s.data as unknown;
    if (!data) continue;
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === "object") {
          const m =
            (item as { completion_method?: string }).completion_method ??
            (item as { method?: string }).method;
          if (m) bump(String(m));
        }
      }
    } else if (typeof data === "object") {
      const arr =
        (data as { outputs?: unknown[] }).outputs ??
        (data as { differentials?: unknown[] }).differentials;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item === "object") {
            const m =
              (item as { completion_method?: string }).completion_method ??
              (item as { method?: string }).method;
            if (m) bump(String(m));
          }
        }
      }
    }
  }
  return hist;
}

async function readPackageVersion(root: string): Promise<string> {
  // Walk up from pipeline package to monorepo root package.json
  const candidates = [
    path.resolve(root, "package.json"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../package.json"),
  ];
  for (const c of candidates) {
    try {
      const raw = JSON.parse(await readFile(c, "utf8")) as { version?: string; name?: string };
      if (raw.version && (raw.name === "ai2live" || c.includes("package.json"))) {
        if (raw.name === "ai2live") return raw.version;
      }
    } catch {
      /* try next */
    }
  }
  try {
    const repoPkg = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../package.json"
    );
    const raw = JSON.parse(await readFile(repoPkg, "utf8")) as { version?: string };
    return raw.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}


export async function runFullPipeline(
  opts: RunFullPipelineOptions
): Promise<PipelineResult> {
  const root = path.resolve(opts.projectRoot);
  const dryRun = Boolean(opts.dryRun);
  const provider = (opts.provider ?? resolveProviderId()) as ProviderId;
  const skip: Partial<Record<StepId, boolean>> = { ...(opts.skip ?? {}) };
  // Compile is a primary deliverable — never skippable in Run All / runFullPipeline
  if (skip.compile) {
    delete skip.compile;
  }
  const onEvent = opts.onEvent;

  if (dryRun) {
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
  }
  process.env.AI2LIVE_MODEL_PROVIDER = provider;

  const steps: StepRecord[] = [];
  const artifacts: Record<string, string | undefined> = {};
  let qcPassed: boolean | undefined;
  let compiled: Awaited<ReturnType<typeof compilePsd>> | undefined;
  let failed = false;
  let handoffPath: string | undefined;

  const runStep = async (
    id: StepId,
    fn: () => Promise<{ message?: string; data?: unknown; softFail?: boolean } | void>,
    options?: { soft?: boolean }
  ): Promise<void> => {
    checkAbort(opts.signal);
    if (skip[id]) {
      const rec: StepRecord = {
        id,
        status: "skip",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        message: "skipped",
      };
      steps.push(rec);
      emit(onEvent, { type: "step_end", step: id, message: "skipped", data: rec });
      return;
    }

    const startedAt = new Date().toISOString();
    emit(onEvent, { type: "step_start", step: id, message: `Starting ${id}` });
    try {
      const result = (await fn()) ?? {};
      const status = result.softFail ? "warn" : "ok";
      const rec: StepRecord = {
        id,
        status,
        startedAt,
        endedAt: new Date().toISOString(),
        message: result.message,
        data: result.data,
      };
      steps.push(rec);
      try {
        await advanceFromPipelineStep(root, id, status, {
          qcPassed: id === "qc" ? qcPassed : undefined,
        });
      } catch {
        /* state machine best-effort */
      }
      emit(onEvent, {
        type: "step_end",
        step: id,
        message: result.message ?? status,
        data: rec,
      });
    } catch (err) {
      const message = (err as Error).message;
      const rec: StepRecord = {
        id,
        status: options?.soft ? "warn" : "fail",
        startedAt,
        endedAt: new Date().toISOString(),
        message,
      };
      steps.push(rec);
      try {
        await advanceFromPipelineStep(root, id, rec.status, {
          qcPassed: id === "qc" ? false : undefined,
        });
      } catch {
        /* state machine best-effort */
      }
      emit(onEvent, { type: "error", step: id, message, data: rec });
      emit(onEvent, { type: "step_end", step: id, message, data: rec });
      if (!options?.soft) {
        failed = true;
        throw err;
      }
    }
  };

  try {
    // 0. bootstrap from image (optional)
    if (opts.fromImage) {
      await runStep("bootstrap", async () => {
        const r = await bootstrapProjectFromImage({
          projectRoot: root,
          imagePath: opts.fromImage!,
          characterName: opts.characterName,
          provider,
          dryRun,
        });
        artifacts.master = r.masterPath;
        artifacts.reference = r.referencePath;
        artifacts.manifest = r.manifestPath;
        emit(onEvent, {
          type: "log",
          step: "bootstrap",
          message: `Bootstrapped via ${r.method} (${r.canvas.width}x${r.canvas.height})`,
        });
        return { message: `method=${r.method}`, data: r };
      });
    } else if (!skip.bootstrap) {
      // mark bootstrap skipped when no fromImage
      skip.bootstrap = true;
      await runStep("bootstrap", async () => ({}));
    }

    // 1. doctor (soft — warn, don't hard-fail especially in dry-run)
    await runStep(
      "doctor",
      async () => {
        const report = await runDoctor();
        emit(onEvent, {
          type: "log",
          step: "doctor",
          message: formatDoctorReport(report).split("\n").slice(0, 8).join("\n"),
        });
        const activeBad = report.checks.find(
          (c) => c.id === `provider.${report.active_provider}.configured`
        );
        const softFail = Boolean(activeBad && !activeBad.ok && !report.dry_run);
        return {
          message: `active=${report.active_provider} dry_run=${report.dry_run}`,
          data: report,
          softFail: softFail || undefined,
        };
      },
      { soft: true }
    );

    // 2. segment
    await runStep("segment", async () => {
      const r = await seeThroughFromMaster({
        projectRoot: root,
        feather: opts.feather ?? 2,
        splitBilateral: opts.splitBilateral !== false,
        debug: opts.segmentDebug !== false,
      });
      const promoted = await promoteSegmentDrafts(root);
      artifacts.segReport = r.reportPath;
      artifacts.segDebug = r.debugPath;
      emit(onEvent, {
        type: "log",
        step: "segment",
        message: `masks=${r.masks.length} promoted=${promoted.length}`,
      });
      return {
        message: `masks=${r.masks.length}`,
        data: { masks: r.masks.length, promoted, debugPath: r.debugPath },
      };
    });

    // 3. occlusion
    await runStep("occlusion", async () => {
      const r = await completeOcclusionScenarios({ projectRoot: root, dryRun });
      return { message: `outputs=${r.outputs?.length ?? 0}`, data: r.outputs };
    });

    // 4. expressions
    await runStep("expressions", async () => {
      const r = await generateExpressionDifferentials({ projectRoot: root, dryRun });
      return {
        message: `differentials=${r.differentials?.length ?? 0}`,
        data: r.differentials,
      };
    });

    // 5. compile PSD (+ first-class exports/ copy)
    await runStep("compile", async () => {
      compiled = await compilePsd({ projectRoot: root });
      artifacts.psd = compiled.psdPath;
      artifacts.recomposed = compiled.recomposedPath;
      const exported = await exportPsdArtifacts(root, compiled, opts.characterName);
      artifacts.psdExport = exported.psdExport;
      artifacts.importManifest = exported.importManifestExport;
      return {
        message: exported.psdExport,
        data: {
          psdPath: compiled.psdPath,
          psdExport: exported.psdExport,
          importManifestPath: exported.importManifestExport,
        },
      };
    });

    // 6. static QC
    await runStep("qc", async () => {
      const report = await runStaticQc({
        projectRoot: root,
        visionReview: Boolean(opts.visionReview),
      });
      qcPassed = report.passed;
      artifacts.qcReport = path.join(root, "validation", "report.json");
      if (!report.passed) {
        emit(onEvent, {
          type: "log",
          step: "qc",
          message: `QC failed findings=${report.findings.length}`,
        });
      }
      return {
        message: `passed=${report.passed}`,
        data: report,
        softFail: !report.passed,
      };
    });

    // 7. pose grid + diagnose
    await runStep("pose", async () => {
      const grid = await renderPoseGridStub({ projectRoot: root });
      const diag = await diagnosePoseGrid({
        projectRoot: root,
        visionReview: Boolean(opts.visionReview),
      });
      artifacts.diagnosis = path.join(root, "validation", "diagnosis.json");
      return {
        message: `shots=${grid.shots.length} findings=${diag.findings.length}`,
        data: { shots: grid.shots.length, findings: diag.findings },
      };
    });

    // 8. agent repair — if QC failed, or alwaysRepair, unless skipped
    const shouldRepair =
      !skip.repair && (opts.alwaysRepair || qcPassed === false || qcPassed === undefined);
    if (!shouldRepair) {
      skip.repair = true;
    }
    await runStep("repair", async () => {
      const ctx = createAgentContext(root, { providerId: provider });
      const { plan, planPath, repairResultPath } = await runRepairClosedLoop(ctx, {
        applyStub: dryRun && !opts.applyRepair,
        apply: Boolean(opts.applyRepair),
        validationSummary: undefined,
      });
      artifacts.repairPlan = planPath;
      if (repairResultPath) artifacts.repairResult = repairResultPath;
      return {
        message: `repairs=${plan.recommended_repairs.length} apply=${Boolean(opts.applyRepair)}`,
        data: {
          planPath,
          repairs: plan.recommended_repairs.length,
          applied: plan.applied,
          repairResultPath,
        },
      };
    });

    // 9. downstream packages
    await runStep("downstream", async () => {
      const al = await buildAutoLive2dPackage({
        projectRoot: root,
        psdPath: compiled?.psdPath,
        importManifestPath: compiled?.importManifestPath,
      });
      const deep = await writePsd2LiveDeepSession({
        projectRoot: root,
        psdPath: compiled?.psdPath,
        importManifestPath: compiled?.importManifestPath,
      });
      const alInvoke = await invokeAutoLive2dSmoke({ projectRoot: root, packageDir: al.out_dir });
      const p2lInvoke = await invokePsd2LiveSmoke({
        projectRoot: root,
        packageDir: deep.packageResult.out_dir,
      });
      artifacts.autolive2d = al.out_dir;
      artifacts.psd2liveDeep = deep.sessionPath;
      return {
        message: `autolive2d=${al.out_dir}; invoke skipped=${alInvoke.skipped && p2lInvoke.skipped}`,
        data: {
          autolive2d: al.out_dir,
          psd2liveDeep: deep.sessionPath,
          autolive2d_invoke: alInvoke,
          psd2live_invoke: p2lInvoke,
        },
      };
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      emit(onEvent, {
        type: "error",
        message: (err as Error).message,
      });
    }
    failed = true;
  }

  // 10. write pipeline report (+ handoff if failed)
  const reportPath = path.join(root, "validation", "pipeline_report.json");
  await runStep("report", async () => {
    await mkdir(path.join(root, "validation"), { recursive: true });
    const passed =
      !failed &&
      steps.every((s) => s.status === "ok" || s.status === "skip" || s.status === "warn") &&
      qcPassed !== false;

    if (!passed || qcPassed === false) {
      handoffPath = await writeHandoff(root, {
        reason: qcPassed === false ? "static_qc_failed" : "pipeline_failed",
        project_path: root,
        blocking_findings: steps
          .filter((s) => s.status === "fail")
          .map((s) => s.id),
        suggested_actions: [
          "Inspect validation/pipeline_report.json",
          "Inspect validation/report.json",
          "Re-run with --dry-run or fix layer PNGs",
        ],
      });
      artifacts.handoff = handoffPath;
    }

    const pkgVersion = await readPackageVersion(root);
    const asset_sha256_count = await countSha256Assets(root);
    let completion_method_histogram = completionMethodHistogram(steps);
    if (Object.keys(completion_method_histogram).length === 0) {
      for (const rel of [
        "layers/completions/occlusion_report.json",
        "design/differentials/expression_report.json",
      ]) {
        try {
          const raw = JSON.parse(await readFile(path.join(root, rel), "utf8")) as {
            scenarios?: { completion_method?: string }[];
            differentials?: { method?: string; completion_method?: string }[];
          };
          for (const s of raw.scenarios ?? []) {
            if (s.completion_method) {
              completion_method_histogram[s.completion_method] =
                (completion_method_histogram[s.completion_method] ?? 0) + 1;
            }
          }
          for (const d of raw.differentials ?? []) {
            const m = d.completion_method ?? d.method;
            if (m) {
              completion_method_histogram[m] =
                (completion_method_histogram[m] ?? 0) + 1;
            }
          }
        } catch {
          /* optional */
        }
      }
    }

    const payload = {
      version: "0.2",
      package_version: pkgVersion,
      project_path: root,
      timestamp: new Date().toISOString(),
      passed,
      dry_run: dryRun,
      provider,
      from_image: opts.fromImage ?? null,
      qc_passed: qcPassed ?? null,
      completion_method_histogram,
      asset_sha256_count,
      steps,
      artifacts,
      handoff: handoffPath ?? null,
    };
    await writeFile(reportPath, JSON.stringify(payload, null, 2));
    artifacts.pipelineReport = reportPath;
    return { message: reportPath, data: payload };
  });

  // Recompute passed after report step
  let reportPassed = true;
  try {
    const raw = JSON.parse(await readFile(reportPath, "utf8")) as { passed?: boolean };
    reportPassed = Boolean(raw.passed);
  } catch {
    reportPassed = false;
  }

  const result: PipelineResult = {
    projectRoot: root,
    passed: reportPassed,
    dryRun,
    provider,
    steps,
    reportPath,
    artifacts,
    qcPassed,
    handoffPath,
  };

  emit(onEvent, { type: "done", message: `passed=${result.passed}`, data: result });
  return result;
}
