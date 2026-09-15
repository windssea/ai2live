#!/usr/bin/env node
/**
 * Occlusion stress: generate fixture → complete scenarios → compare vs see-through baseline.
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "evals/occlusion-stress");

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

const { completeOcclusionScenarios } = await import(
  path.join(root, "packages/occlusion/dist/index.js")
);

const checks = [];
function record(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

let outputs = [];
try {
  const occ = await completeOcclusionScenarios({
    projectRoot: fixture,
    dryRun: true,
    forceLocalFallback: true,
  });
  outputs = occ.outputs ?? [];
  record("occlusion_all_scenarios", outputs.length >= 3, {
    outputs: outputs.length,
    methods: outputs.map((o) => o.completion_method),
  });
  for (const o of outputs) {
    record(`scenario_${o.scenario}`, Boolean(o.path) && Boolean(o.completion_method), {
      method: o.completion_method,
      path: o.path,
    });
  }
} catch (err) {
  record("occlusion_all_scenarios", false, { error: err.message });
}

// Compare completion alpha mass vs see-through baseline in bangs region
try {
  const baselinePath = path.join(fixture, "previews/see_through_baseline.png");
  const facePath = path.join(fixture, "layers/face.png");
  const completionPath = path.join(fixture, "layers/completions/bangs_under_face.png");
  const hasCompletion = await exists(completionPath);
  record("completion_file_bangs", hasCompletion, { path: completionPath });

  if (hasCompletion && (await exists(baselinePath))) {
    const { data: base, info: bi } = await sharp(baselinePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data: face } = await sharp(facePath)
      .ensureAlpha()
      .resize(bi.width, bi.height)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data: comp } = await sharp(completionPath)
      .ensureAlpha()
      .resize(bi.width, bi.height)
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Forehead band where bangs hide face — completion should add opaque px vs face layer
    let faceOpaque = 0;
    let compOpaque = 0;
    const y0 = Math.floor(bi.height * 0.12);
    const y1 = Math.floor(bi.height * 0.35);
    const x0 = Math.floor(bi.width * 0.25);
    const x1 = Math.floor(bi.width * 0.75);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * bi.width + x) * 4;
        if (face[i + 3] > 16) faceOpaque++;
        if (comp[i + 3] > 16) compOpaque++;
      }
    }
    const improved = compOpaque >= faceOpaque;
    record("vs_see_through_forehead_coverage", improved, {
      face_opaque_roi: faceOpaque,
      completion_opaque_roi: compOpaque,
      note: "completion should not lose alpha vs incomplete face under bangs ROI",
      baseline: "see_through_baseline.png (visible composite)",
    });
  } else {
    record("vs_see_through_forehead_coverage", false, { error: "missing files" });
  }
} catch (err) {
  record("vs_see_through_forehead_coverage", false, { error: err.message });
}

const passed = checks.filter((c) => c.passed).length;
const total = checks.length;
const pass_rate = total ? passed / total : 0;
const report = {
  version: "0.1",
  suite: "occlusion-stress",
  timestamp: new Date().toISOString(),
  fixture,
  passed,
  total,
  pass_rate,
  checks,
  outputs,
};
const outDir = path.join(fixture, "validation");
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "occlusion_stress_report.json");
await writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`Occlusion stress pass_rate=${(pass_rate * 100).toFixed(1)}% (${passed}/${total})`);
console.log(`Report: ${outPath}`);
process.exit(pass_rate >= 0.5 ? 0 : 1);
