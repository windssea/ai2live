#!/usr/bin/env node
/**
 * Flat image eval: generate flat PNGs → run --from-image --dry-run → assert PSD/exports.
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "evals/flat-image");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

process.chdir(root);
const gen = spawnSync(process.execPath, [path.join(fixture, "generate.mjs")], {
  stdio: "inherit",
  cwd: fixture,
  env: { ...process.env, NODE_PATH: path.join(root, "node_modules") },
});
if (gen.status !== 0) {
  const gen2 = spawnSync("pnpm", ["exec", "node", path.join(fixture, "generate.mjs")], {
    stdio: "inherit",
    cwd: root,
  });
  if (gen2.status !== 0) process.exit(gen2.status ?? 1);
}

process.env.AI2LIVE_MODEL_DRY_RUN = "1";
process.env.AI2LIVE_USE_MOCK_RIG = process.env.AI2LIVE_USE_MOCK_RIG ?? "1";

const { runFullPipeline } = await import(path.join(root, "packages/pipeline/dist/index.js"));

const checks = [];
function record(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

const images = ["flat_a.png", "flat_b.png"];
const perImage = [];

for (const img of images) {
  const imgPath = path.join(fixture, "images", img);
  const projectDir = await mkdtemp(path.join(tmpdir(), `ai2live-flat-${img}-`));
  try {
    const result = await runFullPipeline({
      projectRoot: projectDir,
      fromImage: imgPath,
      characterName: `Flat ${img}`,
      dryRun: true,
      provider: "grok",
      skip: { repair: true },
    });
    const psdOk = Boolean(result.artifacts.psd) && (await exists(result.artifacts.psd));
    const exportOk =
      Boolean(result.artifacts.psdExport) && (await exists(result.artifacts.psdExport));
    const manifestOk =
      Boolean(result.artifacts.importManifest) &&
      (await exists(result.artifacts.importManifest));
    record(`from_image_${img}_psd`, psdOk, { psd: result.artifacts.psd });
    record(`from_image_${img}_export`, exportOk, { export: result.artifacts.psdExport });
    record(`from_image_${img}_import_manifest`, manifestOk, {
      importManifest: result.artifacts.importManifest,
    });
    perImage.push({
      image: img,
      projectDir,
      passed: psdOk && exportOk,
      artifacts: result.artifacts,
    });
  } catch (err) {
    record(`from_image_${img}_psd`, false, { error: err.message });
    record(`from_image_${img}_export`, false, { error: err.message });
    record(`from_image_${img}_import_manifest`, false, { error: err.message });
    perImage.push({ image: img, error: err.message });
  } finally {
    // keep temp for debugging? remove to save space
    try {
      await rm(projectDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

const passed = checks.filter((c) => c.passed).length;
const total = checks.length;
const pass_rate = total ? passed / total : 0;
const report = {
  version: "0.1",
  suite: "flat-image",
  timestamp: new Date().toISOString(),
  fixture,
  passed,
  total,
  pass_rate,
  checks,
  perImage: perImage.map(({ image, passed: p, error, artifacts }) => ({
    image,
    passed: p,
    error,
    psd: artifacts?.psd,
    psdExport: artifacts?.psdExport,
  })),
};
const outDir = path.join(fixture, "validation");
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "flat_image_report.json");
await writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`Flat image pass_rate=${(pass_rate * 100).toFixed(1)}% (${passed}/${total})`);
console.log(`Report: ${outPath}`);
process.exit(pass_rate >= 0.5 ? 0 : 1);
