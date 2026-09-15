#!/usr/bin/env node
/**
 * Hair stress eval: generate fixture → occlusion → compile → QC/gates → report pass rates.
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "evals/hair-stress");
const require = createRequire(import.meta.url);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Ensure sharp available via workspace
process.chdir(root);

const gen = spawnSync(process.execPath, [path.join(fixture, "generate.mjs")], {
  stdio: "inherit",
  cwd: fixture,
  env: { ...process.env, NODE_PATH: path.join(root, "node_modules") },
});
if (gen.status !== 0) {
  // retry via pnpm exec / workspace sharp resolution
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
const { compilePsd } = await import(path.join(root, "packages/psd-compiler/dist/index.js"));
const { runStaticQc, runQualityGates } = await import(
  path.join(root, "packages/qc-engine/dist/index.js")
);

const checks = [];

function record(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

try {
  const occ = await completeOcclusionScenarios({
    projectRoot: fixture,
    dryRun: true,
    forceLocalFallback: true,
    scenarios: ["bangs_under_face"],
  });
  record("occlusion_bangs_under_face", occ.outputs.length >= 1, {
    outputs: occ.outputs.length,
    method: occ.outputs[0]?.completion_method,
  });
} catch (err) {
  record("occlusion_bangs_under_face", false, { error: err.message });
}

try {
  const compiled = await compilePsd({ projectRoot: fixture });
  record("compile_psd", Boolean(compiled.psdPath), { psd: compiled.psdPath });
  record("gate6_roundtrip", compiled.roundtrip?.passed !== false, {
    passed: compiled.roundtrip?.passed,
  });
} catch (err) {
  record("compile_psd", false, { error: err.message });
  record("gate6_roundtrip", false, { error: err.message });
}

try {
  const qc = await runStaticQc({ projectRoot: fixture });
  record("static_qc", qc.passed, {
    mae: qc.metrics?.mae,
    findings: qc.findings?.length,
  });
} catch (err) {
  record("static_qc", false, { error: err.message });
}

try {
  const gates = await runQualityGates({ projectRoot: fixture });
  for (const g of gates.gates) {
    record(g.gate, g.passed, { depth: g.depth, metrics: g.metrics });
  }
  record("quality_gates_all", gates.passed, {});
} catch (err) {
  record("quality_gates_all", false, { error: err.message });
}

const passed = checks.filter((c) => c.passed).length;
const total = checks.length;
const pass_rate = total ? passed / total : 0;

const report = {
  version: "0.1",
  suite: "hair-stress",
  timestamp: new Date().toISOString(),
  fixture,
  passed,
  total,
  pass_rate,
  checks,
};

const outDir = path.join(fixture, "validation");
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "hair_stress_report.json");
await writeFile(outPath, JSON.stringify(report, null, 2));

console.log(`Hair stress pass_rate=${(pass_rate * 100).toFixed(1)}% (${passed}/${total})`);
console.log(`Report: ${outPath}`);
process.exit(pass_rate >= 0.5 ? 0 : 1);
