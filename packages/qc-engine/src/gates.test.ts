import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { runQualityGates, runGate2VisiblePixelFidelity } from "./gates.js";
import { assertLayerManifest } from "@ai2live/manifest-schema";
import { readFile } from "node:fs/promises";
import type { LayerManifest } from "@ai2live/domain";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const example = path.join(repoRoot, "examples/simple-character");

describe("quality gates", () => {
  beforeAll(async () => {
    try {
      await access(path.join(example, "layers/face.png"));
    } catch {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)("node", [path.join(example, "generate-assets.mjs")], {
        cwd: example,
      });
    }
  }, 60_000);

  it("runs gates 0–5 suite and writes metrics", async () => {
    const report = await runQualityGates({ projectRoot: example });
    expect(report.gates.map((g) => g.gate)).toContain("GATE_2_VISIBLE_PIXEL_FIDELITY");
    expect(report.gates.map((g) => g.gate)).toContain("GATE_4_OVERLAP_SUFFICIENCY");
    expect(report.gates.map((g) => g.gate)).toContain("GATE_7_RIG_EXTREME_POSE");
    expect(report.gates.map((g) => g.gate)).toContain("GATE_8_EDITABILITY");
    expect(report.gates).toHaveLength(8);
    const g2 = report.gates.find((g) => g.gate === "GATE_2_VISIBLE_PIXEL_FIDELITY")!;
    expect(g2.depth).toBe("implemented");
    const g0 = report.gates.find((g) => g.gate === "GATE_0_MASTER_BINDABILITY")!;
    expect(g0.depth).toBe("heuristic");
    expect(typeof g0.metrics.master_coverage).toBe("number");
    const g1 = report.gates.find((g) => g.gate === "GATE_1_LAYER_PLAN")!;
    expect(g1.depth).toBe("heuristic");
    const g5 = report.gates.find((g) => g.gate === "GATE_5_GENERATED_REGION")!;
    expect(g5.depth).toBe("heuristic");
    expect(typeof g2.metrics.visible_pixel_reuse_ratio === "number" || g2.findings.length > 0).toBe(
      true
    );
  }, 60_000);

  it("Gate 2 computes reuse ratio on example", async () => {
    const manifest = assertLayerManifest(
      JSON.parse(await readFile(path.join(example, "spec/layer_manifest.json"), "utf8"))
    ) as LayerManifest;
    const g2 = await runGate2VisiblePixelFidelity(
      example,
      manifest,
      path.join(example, "design/master_neutral.png"),
      { minRatio: 0.5 }
    );
    expect(g2.metrics.gate2_layers_checked ?? 0).toBeGreaterThan(0);
  }, 60_000);
});
