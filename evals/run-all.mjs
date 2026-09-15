#!/usr/bin/env node
/**
 * Aggregate hair-stress + occlusion-stress + flat-image → evals/last-report.json
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evalsDir = path.join(root, "evals");

const suites = [
  {
    id: "hair-stress",
    script: path.join(evalsDir, "run-hair-stress.mjs"),
    report: path.join(evalsDir, "hair-stress/validation/hair_stress_report.json"),
  },
  {
    id: "occlusion-stress",
    script: path.join(evalsDir, "run-occlusion-stress.mjs"),
    report: path.join(evalsDir, "occlusion-stress/validation/occlusion_stress_report.json"),
  },
  {
    id: "flat-image",
    script: path.join(evalsDir, "run-flat-image.mjs"),
    report: path.join(evalsDir, "flat-image/validation/flat_image_report.json"),
  },
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

process.chdir(root);
process.env.AI2LIVE_MODEL_DRY_RUN = "1";
process.env.AI2LIVE_USE_MOCK_RIG = process.env.AI2LIVE_USE_MOCK_RIG ?? "1";

const results = [];
for (const s of suites) {
  console.log(`\n=== Running suite: ${s.id} ===`);
  const r = spawnSync(process.execPath, [s.script], {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, AI2LIVE_MODEL_DRY_RUN: "1" },
  });
  let report = null;
  if (await exists(s.report)) {
    try {
      report = JSON.parse(await readFile(s.report, "utf8"));
    } catch {
      report = null;
    }
  }
  results.push({
    id: s.id,
    exit_code: r.status ?? 1,
    pass_rate: report?.pass_rate ?? null,
    passed: report?.passed ?? null,
    total: report?.total ?? null,
    report_path: s.report,
    ok: (r.status ?? 1) === 0,
  });
}

const rates = results.filter((r) => typeof r.pass_rate === "number").map((r) => r.pass_rate);
const aggregate_pass_rate =
  rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
const all_ok = results.every((r) => r.ok);

const aggregate = {
  version: "0.1",
  timestamp: new Date().toISOString(),
  suites: results,
  aggregate_pass_rate,
  all_ok,
};

await mkdir(evalsDir, { recursive: true });
const outPath = path.join(evalsDir, "last-report.json");
await writeFile(outPath, JSON.stringify(aggregate, null, 2));
console.log("\n=== Eval aggregate ===");
for (const r of results) {
  const pct =
    typeof r.pass_rate === "number" ? `${(r.pass_rate * 100).toFixed(1)}%` : "n/a";
  console.log(`  ${r.id}: pass_rate=${pct} exit=${r.exit_code}`);
}
console.log(`aggregate_pass_rate=${(aggregate_pass_rate * 100).toFixed(1)}%`);
console.log(`Wrote ${outPath}`);
process.exit(all_ok ? 0 : 1);
