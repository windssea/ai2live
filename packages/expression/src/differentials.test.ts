import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { generateExpressionDifferentials } from "./differentials.js";

describe("generateExpressionDifferentials", () => {
  const ENV_KEYS = ["AI2LIVE_MODEL_DRY_RUN", "AI2LIVE_MODEL_PROVIDER"] as const;
  const saved: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-expr-"));
    const w = 64;
    const h = 64;
    await mkdir(path.join(dir, "spec"), { recursive: true });
    await mkdir(path.join(dir, "design"), { recursive: true });
    const rgba = Buffer.alloc(w * h * 4, 0);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 240;
      rgba[i + 1] = 220;
      rgba[i + 2] = 200;
      rgba[i + 3] = 255;
    }
    await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toFile(path.join(dir, "design/master_neutral.png"));

    await writeFile(
      path.join(dir, "spec/layer_manifest.json"),
      JSON.stringify({
        id: "man_expr_test",
        version: "0.1",
        character_id: "char_expr_test",
        canvas: { width: w, height: h },
        layers: [
          {
            id: "layer_mouth",
            display_name: "mouth",
            semantic: "MOUTH",
            side: "CENTER",
            z_index: 30,
            canvas_bounds: { x: 0.35, y: 0.55, w: 0.3, h: 0.12 },
            source: { type: "user_asset", asset_path: "layers/mouth.png" },
          },
          {
            id: "layer_eye_l",
            display_name: "eye_l",
            semantic: "EYE",
            side: "LEFT",
            z_index: 35,
            canvas_bounds: { x: 0.25, y: 0.35, w: 0.15, h: 0.1 },
            source: { type: "user_asset", asset_path: "layers/eye_l.png" },
          },
          {
            id: "layer_eye_r",
            display_name: "eye_r",
            semantic: "EYE",
            side: "RIGHT",
            z_index: 35,
            canvas_bounds: { x: 0.6, y: 0.35, w: 0.15, h: 0.1 },
            source: { type: "user_asset", asset_path: "layers/eye_r.png" },
          },
        ],
      })
    );
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("writes differentials with provenance prompt_hash + method via dry-run path", async () => {
    const { differentials, reportPath } = await generateExpressionDifferentials({
      projectRoot: dir,
      dryRun: true,
      kinds: ["mouth_open", "eye_close"],
    });
    expect(differentials).toHaveLength(2);
    for (const d of differentials) {
      await access(path.join(dir, d.path));
      expect(d.prompt_hash).toMatch(/^[0-9a-f]{16}$/);
      expect(d.provenance.method).toMatch(/stub|image_edit/);
      expect(d.provenance.prompt).toContain("Edit Delta");
    }
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.differentials[0].provenance.prompt_hash).toBeTruthy();
  }, 30_000);
});
