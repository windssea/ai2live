#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { compilePsd } from "@ai2live/psd-compiler";
import { runStaticQc } from "@ai2live/qc-engine";
import { buildAutoLive2dPackage } from "@ai2live/autolive2d-adapter";
import { buildPsd2LivePackage } from "@ai2live/psd2live-adapter";
import { validateLayerManifest, validateCharacter } from "@ai2live/manifest-schema";
import { HistoryStore } from "@ai2live/history";

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
      if (!report.passed) {
        process.exitCode = 1;
      }
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

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
