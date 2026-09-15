#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { compilePsd } from "@ai2live/psd-compiler";
import { runStaticQc } from "@ai2live/qc-engine";
import { buildAutoLive2dPackage, invokeAutoLive2dSmoke } from "@ai2live/autolive2d-adapter";
import { buildPsd2LivePackage, writePsd2LiveDeepSession, invokePsd2LiveSmoke } from "@ai2live/psd2live-adapter";
import { validateLayerManifest, validateCharacter } from "@ai2live/manifest-schema";
import {
  HistoryStore,
  loadHistoryStore,
  checkoutRevision,
  appendImportantRevision,
} from "@ai2live/history";
import {
  loadProjectState,
  formatStatus,
  advanceProjectState,
  type ProjectState,
} from "@ai2live/state-machine";
import { seeThroughFromMaster } from "@ai2live/segmentation";
import { completeOcclusionScenarios } from "@ai2live/occlusion";
import { generateExpressionDifferentials } from "@ai2live/expression";
import { renderPoseGridStub, diagnosePoseGrid, runRepairLoopStub } from "@ai2live/repair";
import {
  createAgentContext,
  runPlannerChat,
  runDiagnoseChat,
  runRepairClosedLoop,
} from "@ai2live/agent-runtime";
import {
  listProviders,
  resolveProviderId,
  runDoctor,
  formatDoctorReport,
  type ProviderId,
} from "@ai2live/model-providers";
import { editImageViaProvider } from "@ai2live/image-client";
import { runFullPipeline, type StepId } from "@ai2live/pipeline";
import { replaceLayerPng } from "@ai2live/layer-ops";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const program = new Command();
program.name("ai2live").description("AI Live2D Asset Compiler CLI").version("0.1.0");

program
  .command("compile")
  .description("Compile LayerManifest + PNGs → PSD + adapter packages + static QC")
  .argument("<projectDir>", "Project directory containing spec/ and layers/")
  .option("--skip-adapters", "Skip AutoLive2d / psd2live package writers")
  .option("--skip-qc", "Skip static QC")
  .action(async (projectDir: string, opts: { skipAdapters?: boolean; skipQc?: boolean }) => {
    const root = path.resolve(projectDir);
    console.log(`Compiling ${root}`);

    const history = new HistoryStore();
    const head0 = history.append({
      expected_head: null,
      action: "compile_psd",
      message: `compile ${root}`,
      seed: `compile-${root}`,
    });

    const result = await compilePsd({ projectRoot: root });
    console.log(`PSD: ${result.psdPath}`);
    console.log(`Import manifest: ${result.importManifestPath}`);
    console.log(`Recomposed: ${result.recomposedPath}`);

    if (!opts.skipQc) {
      const report = await runStaticQc({ projectRoot: root });
      console.log(`QC passed=${report.passed} findings=${report.findings.length}`);
      console.log(`Report: ${path.join(root, "validation", "report.json")}`);
      if (!report.passed) process.exitCode = 1;
    }

    if (!opts.skipAdapters) {
      const al = await buildAutoLive2dPackage({
        projectRoot: root,
        psdPath: result.psdPath,
        importManifestPath: result.importManifestPath,
      });
      console.log(`AutoLive2d package: ${al.out_dir}`);
      const p2 = await buildPsd2LivePackage({
        projectRoot: root,
        psdPath: result.psdPath,
        importManifestPath: result.importManifestPath,
      });
      console.log(`psd2live package: ${p2.out_dir}`);
    }

    history.append({
      expected_head: head0.id,
      action: "commit_head",
      message: "compile complete",
      seed: `compile-done-${root}`,
    });
    console.log("Done.");
  });

program
  .command("validate")
  .description("Validate schemas + run static QC on a project")
  .argument("<projectDir>", "Project directory")
  .option("--vision-review", "DESIGN §16 dual-judge: CV + optional VLM (dry-run mock by default)")
  .action(async (projectDir: string, opts: { visionReview?: boolean }) => {
    const root = path.resolve(projectDir);
    const charPath = path.join(root, "spec", "character.json");
    const manPath = path.join(root, "spec", "layer_manifest.json");

    try {
      const char = JSON.parse(await readFile(charPath, "utf8"));
      const cr = validateCharacter(char);
      console.log(`character.json valid=${cr.valid}`);
      if (!cr.valid) console.error(cr.errors);
    } catch (e) {
      console.warn(`character.json: ${(e as Error).message}`);
    }

    const man = JSON.parse(await readFile(manPath, "utf8"));
    const mr = validateLayerManifest(man);
    console.log(`layer_manifest.json valid=${mr.valid}`);
    if (!mr.valid) {
      console.error(mr.errors);
      process.exitCode = 1;
      return;
    }

    const report = await runStaticQc({
      projectRoot: root,
      visionReview: Boolean(opts.visionReview),
    });
    console.log(`Static QC passed=${report.passed}`);
    console.log(JSON.stringify(report.metrics, null, 2));
    for (const f of report.findings) {
      console.log(`[${f.severity}] ${f.type}: ${f.message ?? ""}`);
    }
    if (!report.passed) process.exitCode = 1;
  });

program
  .command("segment")
  .description("M1: see-through segmentation (threshold, CC, feather, bilateral split)")
  .argument("<projectDir>")
  .option("--feather <px>", "Soft edge radius in pixels", (v) => Number(v), 0)
  .option("--split-bilateral", "Split LEFT/RIGHT for eyes/arms via alpha valley / midpoint")
  .option("--debug", "Write previews/seg_debug.png collage")
  .option("--alpha-threshold <n>", "Alpha cutoff 0-255", (v) => Number(v), 8)
  .action(
    async (
      projectDir: string,
      opts: { feather?: number; splitBilateral?: boolean; debug?: boolean; alphaThreshold?: number }
    ) => {
      const root = path.resolve(projectDir);
      const r = await seeThroughFromMaster({
        projectRoot: root,
        feather: opts.feather ?? 0,
        splitBilateral: Boolean(opts.splitBilateral),
        debug: Boolean(opts.debug),
        alphaThreshold: opts.alphaThreshold ?? 8,
      });
      const mean =
        r.masks.length === 0
          ? 0
          : r.masks.reduce((s, m) => s + m.stats.coverage, 0) / r.masks.length;
      console.log(
        `masks=${r.masks.length} drafts=${r.outLayers.length} mean_coverage=${mean.toFixed(4)}`
      );
      console.log(`report: ${r.reportPath}`);
      if (r.debugPath) console.log(`debug: ${r.debugPath}`);
    }
  );

program
  .command("occlusion")
  .description("M2: complete bangs/face/back-hair/arm-root scenarios")
  .argument("<projectDir>")
  .action(async (projectDir: string) => {
    const r = await completeOcclusionScenarios({ projectRoot: path.resolve(projectDir) });
    console.log(JSON.stringify(r.outputs, null, 2));
  });

program
  .command("expressions")
  .description("M3: generate full-character expression differentials")
  .argument("<projectDir>")
  .action(async (projectDir: string) => {
    const r = await generateExpressionDifferentials({ projectRoot: path.resolve(projectDir) });
    console.log(JSON.stringify(r.differentials, null, 2));
  });

program
  .command("repair")
  .description("M4: pose grid + diagnosis + repair plan stub")
  .argument("<projectDir>")
  .option("--loop", "Run repair loop stub")
  .option("--vision-review", "DESIGN §16 dual-judge on pose QA")
  .action(async (projectDir: string, opts: { loop?: boolean; visionReview?: boolean }) => {
    const root = path.resolve(projectDir);
    const grid = await renderPoseGridStub({ projectRoot: root });
    console.log(`pose shots=${grid.shots.length}`);
    const diag = await diagnosePoseGrid({
      projectRoot: root,
      visionReview: Boolean(opts.visionReview),
    });
    console.log(`findings=${diag.findings.length} repairs=${diag.recommended_repairs.length}`);
    if (opts.loop) {
      const loop = await runRepairLoopStub({ projectRoot: root });
      console.log(loop);
    }
  });

program
  .command("downstream")
  .description("M5: write AutoLive2d + psd2live deep session packages")
  .argument("<projectDir>")
  .option("--deep", "Include psd2live deep_session.json")
  .action(async (projectDir: string, opts: { deep?: boolean }) => {
    const root = path.resolve(projectDir);
    const al = await buildAutoLive2dPackage({ projectRoot: root });
    const alInvoke = await invokeAutoLive2dSmoke({ projectRoot: root, packageDir: al.out_dir });
    console.log(`autolive2d: ${al.out_dir}`);
    console.log(`autolive2d invoke: ${alInvoke.skipped ? "skipped" : "attempted"} (${alInvoke.report_path})`);
    if (opts.deep) {
      const deep = await writePsd2LiveDeepSession({ projectRoot: root });
      const p2lInvoke = await invokePsd2LiveSmoke({
        projectRoot: root,
        packageDir: deep.packageResult.out_dir,
      });
      console.log(`psd2live deep: ${deep.sessionPath}`);
      console.log(`psd2live invoke: ${p2lInvoke.skipped ? "skipped" : "attempted"} (${p2lInvoke.report_path})`);
    } else {
      const p2 = await buildPsd2LivePackage({ projectRoot: root });
      const p2lInvoke = await invokePsd2LiveSmoke({ projectRoot: root, packageDir: p2.out_dir });
      console.log(`psd2live: ${p2.out_dir}`);
      console.log(`psd2live invoke: ${p2lInvoke.skipped ? "skipped" : "attempted"} (${p2lInvoke.report_path})`);
    }
  });

function attachRunFlags(cmd: Command) {
  return cmd
    .option("--provider <id>", "grok | openai | codex")
    .option("--dry-run", "Force AI2LIVE_MODEL_DRY_RUN=1 (LLM stubs)")
    .option("--from-image <path>", "Bootstrap project from a single character design PNG")
    .option("--name <name>", "Character name when using --from-image")
    .option("--skip-segment", "Skip see-through segmentation")
    .option("--skip-repair", "Skip agent repair step")
    .option("--skip-occlusion", "Skip occlusion completion")
    .option("--skip-expressions", "Skip expression differentials")
    .option("--skip-downstream", "Skip AutoLive2d / psd2live packages")
    .option("--always-repair", "Run agent repair even when QC passed")
    .option("--apply-repair", "After repair plan, apply deterministic repair + re-QC")
    .option("--json-events", "Emit NDJSON PipelineEvents to stdout (for Studio)")
    .option("--feather <px>", "Segment feather radius", (v) => Number(v), 2)
    .option("--no-split-bilateral", "Disable bilateral eye/arm split");
}

async function executeRun(
  projectDir: string,
  opts: {
    provider?: string;
    dryRun?: boolean;
    fromImage?: string;
    name?: string;
    skipSegment?: boolean;
    skipRepair?: boolean;
    skipOcclusion?: boolean;
    skipExpressions?: boolean;
    skipDownstream?: boolean;
    alwaysRepair?: boolean;
    applyRepair?: boolean;
    jsonEvents?: boolean;
    feather?: number;
    splitBilateral?: boolean;
  }
) {
  const root = path.resolve(projectDir);
  const skip: Partial<Record<StepId, boolean>> = {};
  if (opts.skipSegment) skip.segment = true;
  if (opts.skipRepair) skip.repair = true;
  if (opts.skipOcclusion) skip.occlusion = true;
  if (opts.skipExpressions) skip.expressions = true;
  if (opts.skipDownstream) skip.downstream = true;

  const jsonEvents = Boolean(opts.jsonEvents);
  const result = await runFullPipeline({
    projectRoot: root,
    provider: opts.provider as "grok" | "openai" | "codex" | undefined,
    dryRun: Boolean(opts.dryRun),
    fromImage: opts.fromImage ? path.resolve(opts.fromImage) : undefined,
    characterName: opts.name,
    skip,
    alwaysRepair: Boolean(opts.alwaysRepair),
    applyRepair: Boolean(opts.applyRepair),
    feather: opts.feather,
    splitBilateral: opts.splitBilateral,
    onEvent: (e) => {
      if (jsonEvents) {
        process.stdout.write(JSON.stringify(e) + "\n");
      } else if (e.type === "step_start") {
        console.error(`→ ${e.step}: ${e.message ?? ""}`);
      } else if (e.type === "step_end") {
        console.error(`✓ ${e.step}: ${e.message ?? ""}`);
      } else if (e.type === "log") {
        console.error(e.message ?? "");
      } else if (e.type === "error") {
        console.error(`✗ ${e.step ?? ""}: ${e.message ?? ""}`);
      }
    },
  });

  if (!jsonEvents) {
    const psdPrimary = result.artifacts.psdExport || result.artifacts.psd;
    console.log("");
    console.log("=== PSD（主产物 / primary deliverable）===");
    if (psdPrimary) {
      console.log(`PSD: ${psdPrimary}`);
    } else {
      console.log("PSD: (not produced — compile did not complete)");
    }
    if (
      result.artifacts.psd &&
      result.artifacts.psdExport &&
      result.artifacts.psd !== result.artifacts.psdExport
    ) {
      console.log(`PSD (working copy): ${result.artifacts.psd}`);
    }
    if (result.artifacts.importManifest) {
      console.log(`import_manifest: ${result.artifacts.importManifest}`);
    }
    console.log("---");
    console.log(`pipeline report: ${result.reportPath}`);
    console.log(`passed=${result.passed} provider=${result.provider} dryRun=${result.dryRun}`);
    if (result.artifacts.autolive2d) console.log(`autolive2d: ${result.artifacts.autolive2d}`);
    if (result.artifacts.psd2liveDeep) console.log(`psd2live: ${result.artifacts.psd2liveDeep}`);
  }
  // Avoid dangling promise / pnpm-exec printing "undefined" on failure paths
  if (!result.passed) {
    process.exitCode = 1;
  }
}

attachRunFlags(
  program
    .command("run")
    .description("One-shot full pipeline (统一控制台): doctor→segment→…→PSD→QC→adapters")
    .argument("<projectDir>", "Project directory (created/used with --from-image)")
).action(async (projectDir: string, opts) => {
  await executeRun(projectDir, opts);
  return;
});

attachRunFlags(
  program
    .command("pipeline")
    .description("Alias for `ai2live run`")
    .argument("<projectDir>", "Project directory")
).action(async (projectDir: string, opts) => {
  await executeRun(projectDir, opts);
  return;
});

program
  .command("unattended")
  .description("Deprecated alias for `ai2live run` (same orchestrator)")
  .argument("<projectDir>")
  .option("--provider <id>", "grok | openai | codex")
  .option("--dry-run", "Force dry-run")
  .option("--json-events", "NDJSON events")
  .action(async (projectDir: string, opts: { provider?: string; dryRun?: boolean; jsonEvents?: boolean }) => {
    console.error("note: `unattended` now wraps `ai2live run` — prefer `ai2live run`");
    await executeRun(projectDir, {
      provider: opts.provider,
      dryRun: opts.dryRun,
      jsonEvents: opts.jsonEvents,
      skipRepair: true,
    });
  });

program
  .command("doctor")
  .description("Check env keys (presence only), provider config, worker reachability — never prints secrets")
  .option("--json", "Print machine-readable JSON report")
  .action(async (opts: { json?: boolean }) => {
    const report = await runDoctor();
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatDoctorReport(report));
    }
    // Non-zero when active provider unconfigured (and not dry-run) or worker set but down
    const activeBad = report.checks.find(
      (c) => c.id === `provider.${report.active_provider}.configured`
    );
    if (activeBad && !activeBad.ok && !report.dry_run) process.exitCode = 1;
    const worker = report.checks.find((c) => c.id === "worker.reachable");
    if (worker && !worker.ok) process.exitCode = 1;
  });

program
  .command("providers")
  .description("List model providers and whether they are configured")
  .action(() => {
    const active = resolveProviderId();
    const rows = listProviders();
    console.log(`Active default (AI2LIVE_MODEL_PROVIDER): ${active}`);
    console.log("");
    for (const p of rows) {
      const mark = p.configured ? "yes" : "no";
      const star = p.id === active ? "*" : " ";
      console.log(
        `${star} ${p.id.padEnd(8)} configured=${mark.padEnd(3)} kind=${p.kind} model=${p.defaultModel ?? "-"}`
      );
    }
    console.log("");
    console.log("Switch: export AI2LIVE_MODEL_PROVIDER=grok|openai|codex");
    console.log("Dry-run: export AI2LIVE_MODEL_DRY_RUN=1");
    console.log("Docs: docs/providers.md");
  });

const agent = program.command("agent").description("LLM planning / diagnosis (pluggable providers)");

agent
  .command("plan")
  .description("Call LLM (or dry-run) to produce/augment plan JSON for a project")
  .argument("<projectDir>", "Project directory")
  .option("--provider <id>", "grok | openai | codex (default: AI2LIVE_MODEL_PROVIDER or grok)")
  .option("--prompt <text>", "Extra user goals for the planner")
  .option("-o, --out <file>", "Write plan JSON to this path (default: validation/llm_plan.json)")
  .action(
    async (
      projectDir: string,
      opts: { provider?: string; prompt?: string; out?: string }
    ) => {
      const root = path.resolve(projectDir);
      const providerId = resolveProviderId(opts.provider) as ProviderId;
      const ctx = createAgentContext(root, { providerId });
      console.log(`Planning with provider=${ctx.provider.id} project=${root}`);

      try {
        const { plan, result, parsed } = await runPlannerChat(ctx, {
          userPrompt: opts.prompt,
        });
        const outPath = path.resolve(opts.out ?? path.join(root, "validation", "llm_plan.json"));
        await mkdir(path.dirname(outPath), { recursive: true });
        const payload = {
          provider: result.provider,
          model: result.model,
          plan,
          parsed,
          raw_text: result.text,
        };
        await writeFile(outPath, JSON.stringify(payload, null, 2));
        console.log(`Wrote ${outPath}`);
        console.log(`plan steps=${plan.length}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      }
    }
  );

agent
  .command("diagnose")
  .description("Feed validation report to LLM for repair suggestions → validation/llm_diagnosis.json")
  .argument("<projectDir>", "Project directory")
  .option("--provider <id>", "grok | openai | codex")
  .option("--prompt <text>", "Extra notes for the diagnoser")
  .option("-o, --out <file>", "Output path (default: validation/llm_diagnosis.json)")
  .action(
    async (
      projectDir: string,
      opts: { provider?: string; prompt?: string; out?: string }
    ) => {
      const root = path.resolve(projectDir);
      const providerId = resolveProviderId(opts.provider) as ProviderId;
      const ctx = createAgentContext(root, { providerId });

      let validationSummary: unknown = { note: "no validation/report.json found" };
      const reportPath = path.join(root, "validation", "report.json");
      try {
        validationSummary = JSON.parse(await readFile(reportPath, "utf8"));
      } catch {
        try {
          const diagPath = path.join(root, "validation", "diagnosis.json");
          validationSummary = JSON.parse(await readFile(diagPath, "utf8"));
        } catch {
          /* keep stub */
        }
      }

      console.log(`Diagnosing with provider=${ctx.provider.id} project=${root}`);
      try {
        const { result, parsed } = await runDiagnoseChat(ctx, {
          validationSummary,
          userPrompt: opts.prompt,
        });
        const outPath = path.resolve(
          opts.out ?? path.join(root, "validation", "llm_diagnosis.json")
        );
        await mkdir(path.dirname(outPath), { recursive: true });
        const payload = {
          provider: result.provider,
          model: result.model,
          diagnosis: parsed,
          raw_text: result.text,
        };
        await writeFile(outPath, JSON.stringify(payload, null, 2));
        console.log(`Wrote ${outPath}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      }
    }
  );


agent
  .command("repair")
  .description("Closed loop: pose diagnose → LLM repair plan → validation/repair_plan.json (+ history)")
  .argument("<projectDir>", "Project directory")
  .option("--provider <id>", "grok | openai | codex")
  .option("--prompt <text>", "Extra notes for the diagnoser")
  .option("--apply-stub", "Record stub apply markers (no PNG mutation)")
  .option("--apply", "Apply ≥1 deterministic repair (occlusion/feather/recompile) then re-QC")
  .option("--skip-pose", "Skip pose grid render/diagnose before LLM plan")
  .action(
    async (
      projectDir: string,
      opts: { provider?: string; prompt?: string; applyStub?: boolean; apply?: boolean; skipPose?: boolean }
    ) => {
      const root = path.resolve(projectDir);
      const providerId = resolveProviderId(opts.provider) as ProviderId;
      const ctx = createAgentContext(root, { providerId });

      let poseDiagnosis: unknown = undefined;
      if (!opts.skipPose) {
        const grid = await renderPoseGridStub({ projectRoot: root });
        console.log(`pose shots=${grid.shots.length}`);
        poseDiagnosis = await diagnosePoseGrid({ projectRoot: root });
        console.log(
          `pose findings=${(poseDiagnosis as { findings: unknown[] }).findings.length}`
        );
      }

      console.log(`Repair plan with provider=${ctx.provider.id} project=${root}`);
      try {
        const { plan, planPath, historyHead, repairResultPath, qcAfter } = await runRepairClosedLoop(ctx, {
          userPrompt: opts.prompt,
          applyStub: opts.applyStub,
          apply: opts.apply,
          poseDiagnosis,
        });
        console.log(`Wrote ${planPath}`);
        console.log(`repairs=${plan.recommended_repairs.length} history_head=${historyHead}`);
        if (opts.applyStub) {
          console.log(`stub applied markers=${plan.applied?.length ?? 0}`);
        }
        if (opts.apply) {
          console.log(`applied=${plan.applied?.map((a) => a.status).join(",") ?? "none"}`);
          if (repairResultPath) console.log(`repair_result=${repairResultPath}`);
          if (qcAfter && typeof qcAfter === "object" && qcAfter && "passed" in qcAfter) {
            console.log(`qc_after_passed=${(qcAfter as { passed: boolean }).passed}`);
          }
        }
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      }
    }
  );

const image = program.command("image").description("Image edit via providers or worker");

image
  .command("edit")
  .description("Edit an image via provider Images API (or dry-run copy/tiny PNG)")
  .requiredOption("--prompt <text>", "Edit prompt")
  .requiredOption("--input <path>", "Input image path")
  .option("--out <path>", "Output path (default: <project>/previews/image_edit_*.png)")
  .option("--mask <path>", "Optional mask path")
  .option("--provider <id>", "grok | openai (default: AI2LIVE_MODEL_PROVIDER or grok)")
  .option("--project <dir>", "Project root for default output under previews/")
  .action(
    async (opts: {
      prompt: string;
      input: string;
      out?: string;
      mask?: string;
      provider?: string;
      project?: string;
    }) => {
      const projectRoot = opts.project ? path.resolve(opts.project) : process.cwd();
      const inputImagePath = path.resolve(opts.input);
      const outputPath = opts.out ? path.resolve(opts.out) : undefined;
      try {
        const result = await editImageViaProvider({
          prompt: opts.prompt,
          inputImagePath,
          outputPath,
          maskPath: opts.mask ? path.resolve(opts.mask) : undefined,
          projectRoot,
          provider: opts.provider,
        });
        console.log(`Wrote ${result.outputPath} method=${result.method ?? "?"} dryRun=${Boolean(result.dryRun)}`);
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      }
    }
  );




program
  .command("status")
  .description("Show project state machine status (.ai2live/state.json)")
  .argument("<projectDir>", "Project directory")
  .option("--set <state>", "Force-advance to a legal state (for recovery)")
  .action(async (projectDir: string, opts: { set?: string }) => {
    const root = path.resolve(projectDir);
    try {
      if (opts.set) {
        const rec = await advanceProjectState(root, opts.set as ProjectState, {
          reason: "cli status --set",
        });
        console.log(formatStatus(rec));
        console.log(`path=${path.join(root, ".ai2live", "state.json")}`);
        return;
      }
      const rec = await loadProjectState(root);
      console.log(formatStatus(rec));
      console.log(`path=${path.join(root, ".ai2live", "state.json")}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });


const revision = program.command("revision").description("History revision list / checkout / resume");

revision
  .command("list")
  .description("List revisions from validation/history.json")
  .argument("<projectDir>", "Project directory")
  .action(async (projectDir: string) => {
    const root = path.resolve(projectDir);
    const store = await loadHistoryStore(root);
    const nodes = store.getNodes();
    console.log(`head=${store.getHead() ?? "(none)"} count=${nodes.length}`);
    for (const n of nodes) {
      const mark = n.id === store.getHead() ? "*" : " ";
      console.log(`${mark} ${n.id}  ${n.action}  ${n.created_at}  ${n.message ?? ""}`);
    }
  });

revision
  .command("checkout")
  .description("Move HEAD to rev and restore workspace snapshots when present")
  .argument("<projectDir>", "Project directory")
  .argument("<rev>", "Revision id")
  .action(async (projectDir: string, rev: string) => {
    const root = path.resolve(projectDir);
    try {
      const { node, restored, store } = await checkoutRevision(root, rev);
      console.log(`checked out ${node.id} action=${node.action}`);
      console.log(`head=${store.getHead()}`);
      if (restored.length) console.log(`restored: ${restored.join(", ")}`);
      else console.log("no workspace snapshots restored (HEAD moved only)");
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

revision
  .command("resume")
  .description("Alias of checkout — resume from a prior revision")
  .argument("<projectDir>", "Project directory")
  .argument("<rev>", "Revision id")
  .action(async (projectDir: string, rev: string) => {
    const root = path.resolve(projectDir);
    try {
      const { node, restored, store } = await checkoutRevision(root, rev);
      console.log(`resumed ${node.id}`);
      console.log(`head=${store.getHead()} restored=${restored.length}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });



const layer = program.command("layer").description("Human layer ops (replace-and-continue)");

layer
  .command("replace")
  .description("Replace a layer PNG by id, update manifest + history; then compile/run to continue")
  .argument("<projectDir>", "Project directory")
  .argument("<layerId>", "Layer id from layer_manifest.json")
  .requiredOption("--png <path>", "Replacement PNG path")
  .option("--dest <rel>", "Optional relative dest path under project")
  .action(
    async (
      projectDir: string,
      layerId: string,
      opts: { png: string; dest?: string }
    ) => {
      try {
        const result = await replaceLayerPng({
          projectRoot: path.resolve(projectDir),
          layerId,
          pngPath: path.resolve(opts.png),
          destRel: opts.dest,
        });
        console.log(`replaced ${result.layerId}`);
        console.log(`asset_path=${result.asset_path}`);
        console.log(`sha256=${result.sha256}`);
        if (result.content_addressed_path) {
          console.log(`content_addressed=${result.content_addressed_path}`);
        }
        console.log(`history_head=${result.history_head ?? "(none)"}`);
        console.log("continue with: ai2live compile <project>  OR  ai2live run <project>");
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      }
    }
  );

program
  .command("eval")
  .description("Run eval suites (hair-stress + occlusion-stress + flat-image) → evals/last-report.json")
  .option("--suite <id>", "hair-stress | occlusion-stress | flat-image | all", "all")
  .action(async (opts: { suite?: string }) => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const suite = opts.suite ?? "all";
    const script =
      suite === "all"
        ? path.join(repoRoot, "evals/run-all.mjs")
        : suite === "hair-stress"
          ? path.join(repoRoot, "evals/run-hair-stress.mjs")
          : suite === "occlusion-stress"
            ? path.join(repoRoot, "evals/run-occlusion-stress.mjs")
            : suite === "flat-image"
              ? path.join(repoRoot, "evals/run-flat-image.mjs")
              : null;
    if (!script) {
      console.error(`Unknown suite: ${suite}`);
      process.exitCode = 1;
      return;
    }
    const r = spawnSync(process.execPath, [script], {
      stdio: "inherit",
      cwd: repoRoot,
      env: { ...process.env, AI2LIVE_MODEL_DRY_RUN: "1" },
    });
    process.exitCode = r.status ?? 1;
  });


async function main(): Promise<void> {
  try {
    // pnpm run <script> -- <args> may forward a literal "--"; strip it so commander sees the subcommand
    const argv = process.argv.slice();
    if (argv[2] === "--") argv.splice(2, 1);
    await program.parseAsync(argv);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

void main();
