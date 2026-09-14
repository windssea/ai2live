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
import { defaultUnattendedPlan, createAgentContext } from "@ai2live/agent-runtime";

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
  .description("M1: see-through / stub segmentation from master")
  .argument("<projectDir>")
  .action(async (projectDir: string) => {
    const root = path.resolve(projectDir);
    const r = await seeThroughFromMaster({ projectRoot: root });
    console.log(`masks=${r.masks.length} drafts=${r.outLayers.length}`);
  });

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
    console.log(`plan steps=${plan.length}`);

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

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
