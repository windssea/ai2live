#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { compilePsd } from "@ai2live/psd-compiler";
import { runStaticQc } from "@ai2live/qc-engine";
import { buildAutoLive2dPackage } from "@ai2live/autolive2d-adapter";
import { buildPsd2LivePackage, writePsd2LiveDeepSession } from "@ai2live/psd2live-adapter";
import { validateLayerManifest, validateCharacter } from "@ai2live/manifest-schema";
import { HistoryStore } from "@ai2live/history";
import { seeThroughFromMaster } from "@ai2live/segmentation";
import { completeOcclusionScenarios } from "@ai2live/occlusion";
import { generateExpressionDifferentials } from "@ai2live/expression";
import { renderPoseGridStub, diagnosePoseGrid, runRepairLoopStub } from "@ai2live/repair";
import { createBudget, writeHandoff, DEFAULT_RETRY } from "@ai2live/product";
import {
  defaultUnattendedPlan,
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
  .action(async (projectDir: string) => {
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

    const report = await runStaticQc({ projectRoot: root });
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
  .action(async (projectDir: string, opts: { loop?: boolean }) => {
    const root = path.resolve(projectDir);
    const grid = await renderPoseGridStub({ projectRoot: root });
    console.log(`pose shots=${grid.shots.length}`);
    const diag = await diagnosePoseGrid({ projectRoot: root });
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
    console.log(`autolive2d: ${al.out_dir}`);
    if (opts.deep) {
      const deep = await writePsd2LiveDeepSession({ projectRoot: root });
      console.log(`psd2live deep: ${deep.sessionPath}`);
    } else {
      const p2 = await buildPsd2LivePackage({ projectRoot: root });
      console.log(`psd2live: ${p2.out_dir}`);
    }
  });

program
  .command("unattended")
  .description("M6: run default unattended plan (deterministic tools only)")
  .argument("<projectDir>")
  .action(async (projectDir: string) => {
    const root = path.resolve(projectDir);
    const ctx = createAgentContext(root);
    const plan = defaultUnattendedPlan();
    console.log(`budget max_usd=${ctx.budget.max_usd} retry=${DEFAULT_RETRY.max_attempts}`);
    console.log(`plan steps=${plan.length} provider=${ctx.provider.id}`);

    await seeThroughFromMaster({ projectRoot: root });
    await completeOcclusionScenarios({ projectRoot: root });
    await generateExpressionDifferentials({ projectRoot: root });
    const compiled = await compilePsd({ projectRoot: root });
    const qc = await runStaticQc({ projectRoot: root });
    await renderPoseGridStub({ projectRoot: root });
    await diagnosePoseGrid({ projectRoot: root });
    await buildAutoLive2dPackage({
      projectRoot: root,
      psdPath: compiled.psdPath,
      importManifestPath: compiled.importManifestPath,
    });
    await writePsd2LiveDeepSession({
      projectRoot: root,
      psdPath: compiled.psdPath,
      importManifestPath: compiled.importManifestPath,
    });

    await mkdir(path.join(root, "validation"), { recursive: true });
    await writeFile(
      path.join(root, "validation", "unattended_summary.json"),
      JSON.stringify(
        {
          passed: qc.passed,
          plan,
          provider: ctx.provider.id,
          budget: createBudget(),
          retry: DEFAULT_RETRY,
        },
        null,
        2
      )
    );

    if (!qc.passed) {
      await writeHandoff(root, {
        reason: "static_qc_failed",
        project_path: root,
        blocking_findings: qc.findings.filter((f) => f.severity === "ERROR").map((f) => f.type),
        suggested_actions: ["Inspect validation/report.json", "Fix layer PNGs", "Re-run compile"],
      });
      process.exitCode = 1;
    }
    console.log(`unattended done passed=${qc.passed}`);
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
  .option("--skip-pose", "Skip pose grid render/diagnose before LLM plan")
  .action(
    async (
      projectDir: string,
      opts: { provider?: string; prompt?: string; applyStub?: boolean; skipPose?: boolean }
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
        const { plan, planPath, historyHead } = await runRepairClosedLoop(ctx, {
          userPrompt: opts.prompt,
          applyStub: opts.applyStub,
          poseDiagnosis,
        });
        console.log(`Wrote ${planPath}`);
        console.log(`repairs=${plan.recommended_repairs.length} history_head=${historyHead}`);
        if (opts.applyStub) {
          console.log(`stub applied markers=${plan.applied?.length ?? 0}`);
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


program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
