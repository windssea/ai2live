import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAgentContext,
  parseRepairPlan,
  runRepairClosedLoop,
} from "./index.js";

const ENV_KEYS = ["AI2LIVE_MODEL_DRY_RUN", "AI2LIVE_MODEL_PROVIDER", "AI2LIVE_GROK_API_KEY"] as const;

describe("parseRepairPlan", () => {
  it("maps recommended_repairs and suggestions", () => {
    const plan = parseRepairPlan({
      summary: "needs hair",
      suggestions: ["expand"],
      recommended_repairs: [{ type: "expand_hidden_completion", target: "FRONT_HAIR", rationale: "x" }],
    });
    expect(plan.summary).toBe("needs hair");
    expect(plan.recommended_repairs[0]!.type).toBe("expand_hidden_completion");
    expect(plan.suggestions).toEqual(["expand"]);
  });

  it("accepts action alias", () => {
    const plan = parseRepairPlan({
      recommended_repairs: [{ action: "recompile", reason: "qc failed" }],
    });
    expect(plan.recommended_repairs[0]!.type).toBe("recompile");
    expect(plan.recommended_repairs[0]!.rationale).toBe("qc failed");
  });

  it("handles non-object", () => {
    const plan = parseRepairPlan(null, "raw text");
    expect(plan.suggestions[0]).toContain("raw text");
  });
});

describe("runRepairClosedLoop dry-run", () => {
  const saved: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-repair-"));
    await mkdir(path.join(dir, "validation"), { recursive: true });
    await writeFile(
      path.join(dir, "validation", "report.json"),
      JSON.stringify({ passed: false, findings: [{ type: "PIXEL_DIFF", severity: "ERROR" }] })
    );
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("writes repair_plan.json and history", async () => {
    const ctx = createAgentContext(dir, { providerId: "grok" });
    const { plan, planPath, historyHead } = await runRepairClosedLoop(ctx, {
      applyStub: true,
      poseDiagnosis: { findings: [{ type: "POSE_GRID_OK" }] },
    });
    expect(plan.recommended_repairs.length).toBeGreaterThan(0);
    expect(plan.applied?.[0]?.status).toBe("stub_skipped");
    const written = JSON.parse(await readFile(planPath, "utf8"));
    expect(written.provider).toBe("grok");
    expect(historyHead).toBeTruthy();
    const hist = JSON.parse(await readFile(path.join(dir, "validation", "history.json"), "utf8"));
    expect(hist.nodes.some((n: { action: string }) => n.action === "repair_plan")).toBe(true);
  });

  it("apply writes repair_result.json and history revisions", async () => {
    const w = 32;
    const h = 32;
    await mkdir(path.join(dir, "spec"), { recursive: true });
    await mkdir(path.join(dir, "layers"), { recursive: true });
    await mkdir(path.join(dir, "design"), { recursive: true });
    const sharp = (await import("sharp")).default;
    const rgba = Buffer.alloc(w * h * 4, 0);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 200;
      rgba[i + 1] = 180;
      rgba[i + 2] = 160;
      rgba[i + 3] = 255;
    }
    const png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    await writeFile(path.join(dir, "design/master_neutral.png"), png);
    await writeFile(path.join(dir, "layers/face.png"), png);
    await writeFile(path.join(dir, "layers/front_hair.png"), png);
    await writeFile(
      path.join(dir, "spec/layer_manifest.json"),
      JSON.stringify({
        id: "man_repair",
        version: "0.1",
        character_id: "char_repair",
        canvas: { width: w, height: h },
        layers: [
          {
            id: "layer_face",
            display_name: "face",
            semantic: "FACE",
            side: "CENTER",
            z_index: 40,
            group: "FACE",
            canvas_bounds: { x: 0.2, y: 0.2, w: 0.6, h: 0.5 },
            source: { type: "user_asset", asset_path: "layers/face.png" },
          },
          {
            id: "layer_hair",
            display_name: "front_hair",
            semantic: "FRONT_HAIR",
            side: "CENTER",
            z_index: 50,
            group: "FRONT_HAIR",
            canvas_bounds: { x: 0.15, y: 0.05, w: 0.7, h: 0.3 },
            source: { type: "user_asset", asset_path: "layers/front_hair.png" },
          },
        ],
      })
    );

    const ctx = createAgentContext(dir, { providerId: "grok" });
    const { plan, repairResultPath, historyHead } = await runRepairClosedLoop(ctx, {
      apply: true,
    });
    expect(plan.applied?.some((a) => a.status === "applied")).toBe(true);
    expect(repairResultPath).toBeTruthy();
    const result = JSON.parse(await readFile(repairResultPath!, "utf8"));
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.before).toBeTruthy();
    expect(result.after).toBeTruthy();
    const hist2 = JSON.parse(await readFile(path.join(dir, "validation", "history.json"), "utf8"));
    expect(hist2.nodes.some((n: { action: string }) => n.action === "repair_apply")).toBe(true);
    expect(historyHead).toBeTruthy();
  }, 90_000);
});
