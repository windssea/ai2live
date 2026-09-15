import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGate7RigExtremePose, runGate8Editability } from "./gate78.js";

describe("Gate 7/8", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "g78-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("Gate7 passes with mock-rig extremes contract", async () => {
    const grid = path.join(dir, "validation", "pose_grid");
    await mkdir(grid, { recursive: true });
    await writeFile(
      path.join(grid, "contract.json"),
      JSON.stringify({
        kind: "mock_mesh_warp",
        poses: [
          { pose: {}, path: "validation/pose_grid/pose_00.png" },
          { pose: { ParamAngleX: -30 }, path: "a" },
          { pose: { ParamAngleX: 30 }, path: "b" },
          { pose: { ParamAngleY: -30 }, path: "c" },
          { pose: { ParamAngleY: 30 }, path: "d" },
          { pose: { ParamMouthOpenY: 1 }, path: "e" },
        ],
      })
    );
    for (let i = 0; i < 6; i++) {
      await writeFile(path.join(grid, `pose_0${i}.png`), Buffer.from([0]));
    }
    const g = await runGate7RigExtremePose(dir);
    expect(g.passed).toBe(true);
    expect(g.metrics.head_x_extremes).toBe(2);
    expect(g.metrics.head_y_extremes).toBe(2);
  });

  it("Gate8 checklist scores multi-layer + history", async () => {
    await mkdir(path.join(dir, "layers"), { recursive: true });
    await mkdir(path.join(dir, "spec"), { recursive: true });
    await mkdir(path.join(dir, "validation"), { recursive: true });
    await writeFile(path.join(dir, "layers", "a.png"), Buffer.from([1]));
    await writeFile(path.join(dir, "layers", "b.png"), Buffer.from([1]));
    await writeFile(path.join(dir, "layers", "c.png"), Buffer.from([1]));
    await writeFile(
      path.join(dir, "spec", "layer_manifest.json"),
      JSON.stringify({ layers: [{}, {}, {}] })
    );
    await writeFile(path.join(dir, "validation", "history.json"), "{}");
    const { gate, checklist } = await runGate8Editability(dir);
    expect(checklist.find((c) => c.id === "source_rgba")?.ok).toBe(true);
    expect(checklist.find((c) => c.id === "revision_history")?.ok).toBe(true);
    expect(gate.metrics.editability_ok).toBeGreaterThanOrEqual(3);
  });
});
