import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  buildCompletionMask,
  neighborBlendComplete,
  completeOcclusionScenarios,
} from "./complete.js";

function blank(w: number, h: number): Buffer {
  return Buffer.alloc(w * h * 4, 0);
}

async function writePng(abs: string, rgba: Buffer, w: number, h: number) {
  await mkdir(path.dirname(abs), { recursive: true });
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toFile(abs);
}

describe("buildCompletionMask", () => {
  it("is occluder dilated ∩ missing occludee", () => {
    const w = 16;
    const h = 16;
    const occluder = blank(w, h);
    const occludee = blank(w, h);
    // occluder blob at (4,4)-(7,7)
    for (let y = 4; y <= 7; y++) {
      for (let x = 4; x <= 7; x++) {
        const i = (y * w + x) * 4;
        occluder[i] = occluder[i + 1] = occluder[i + 2] = occluder[i + 3] = 255;
      }
    }
    // occludee opaque everywhere except a hole under occluder at (5,5)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        occludee[i] = 200;
        occludee[i + 1] = 180;
        occludee[i + 2] = 160;
        occludee[i + 3] = 255;
      }
    }
    for (let y = 4; y <= 8; y++) {
      for (let x = 4; x <= 8; x++) {
        const i = (y * w + x) * 4;
        occludee[i + 3] = 0;
      }
    }

    const mask = buildCompletionMask({
      width: w,
      height: h,
      occluderRgba: occluder,
      occludeeRgba: occludee,
      dilateRadius: 2,
    });
    expect(mask.opaque_px).toBeGreaterThan(0);
    // Pixel far from occluder should stay off
    expect(mask.maskRgba[(0 * w + 0) * 4 + 3]).toBe(0);
    // Hole under dilated occluder should be on
    expect(mask.maskRgba[(5 * w + 5) * 4 + 3]).toBe(255);
  });
});

describe("neighborBlendComplete", () => {
  it("fills masked transparent pixels with neighbor colors", () => {
    const w = 8;
    const h = 8;
    const base = blank(w, h);
    const mask = blank(w, h);
    // left half opaque red
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 3; x++) {
        const i = (y * w + x) * 4;
        base[i] = 200;
        base[i + 1] = 40;
        base[i + 2] = 40;
        base[i + 3] = 255;
      }
    }
    // mask a pixel adjacent to the red block
    const mi = (4 * w + 3) * 4;
    mask[mi] = mask[mi + 1] = mask[mi + 2] = mask[mi + 3] = 255;

    const out = neighborBlendComplete({ width: w, height: h, baseRgba: base, maskRgba: mask });
    expect(out[mi + 3]).toBeGreaterThan(150);
    expect(out[mi]).toBeGreaterThan(80); // reddish from neighbors
  });
});

describe("completeOcclusionScenarios dry-run", () => {
  const ENV_KEYS = ["AI2LIVE_MODEL_DRY_RUN", "AI2LIVE_MODEL_PROVIDER"] as const;
  const saved: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-occ-"));
    const w = 32;
    const h = 48;
    await mkdir(path.join(dir, "spec"), { recursive: true });
    await mkdir(path.join(dir, "layers"), { recursive: true });

    const face = blank(w, h);
    const hair = blank(w, h);
    const back = blank(w, h);
    const body = blank(w, h);
    const arm = blank(w, h);
    // face lower area opaque, hole on top
    for (let y = 16; y < 40; y++) {
      for (let x = 8; x < 24; x++) {
        const i = (y * w + x) * 4;
        face[i] = 240;
        face[i + 1] = 200;
        face[i + 2] = 180;
        face[i + 3] = 255;
      }
    }
    for (let y = 4; y < 14; y++) {
      for (let x = 6; x < 26; x++) {
        const i = (y * w + x) * 4;
        hair[i] = 30;
        hair[i + 1] = 20;
        hair[i + 2] = 40;
        hair[i + 3] = 255;
      }
    }
    for (let y = 10; y < 46; y++) {
      for (let x = 4; x < 28; x++) {
        const i = (y * w + x) * 4;
        back[i] = 40;
        back[i + 1] = 30;
        back[i + 2] = 50;
        back[i + 3] = 255;
      }
    }
    for (let y = 28; y < 46; y++) {
      for (let x = 8; x < 24; x++) {
        const i = (y * w + x) * 4;
        body[i] = 80;
        body[i + 1] = 120;
        body[i + 2] = 200;
        body[i + 3] = 255;
      }
    }
    for (let y = 30; y < 46; y++) {
      for (let x = 2; x < 10; x++) {
        const i = (y * w + x) * 4;
        arm[i] = 240;
        arm[i + 1] = 200;
        arm[i + 2] = 180;
        arm[i + 3] = 255;
      }
    }

    await writePng(path.join(dir, "layers/face.png"), face, w, h);
    await writePng(path.join(dir, "layers/front_hair.png"), hair, w, h);
    await writePng(path.join(dir, "layers/back_hair.png"), back, w, h);
    await writePng(path.join(dir, "layers/body.png"), body, w, h);
    await writePng(path.join(dir, "layers/arm_l.png"), arm, w, h);

    const layers = [
      {
        id: "11111111-1111-4111-8111-111111111101",
        display_name: "front hair",
        semantic: "FRONT_HAIR",
        side: "CENTER",
        z_index: 50,
        canvas_bounds: { x: 0.1, y: 0.05, w: 0.8, h: 0.25 },
        source: { type: "master_pixels", asset_path: "layers/front_hair.png" },
      },
      {
        id: "11111111-1111-4111-8111-111111111102",
        display_name: "face",
        semantic: "FACE",
        side: "CENTER",
        z_index: 40,
        canvas_bounds: { x: 0.2, y: 0.2, w: 0.6, h: 0.5 },
        source: { type: "master_pixels", asset_path: "layers/face.png" },
      },
      {
        id: "11111111-1111-4111-8111-111111111103",
        display_name: "back hair",
        semantic: "BACK_HAIR",
        side: "CENTER",
        z_index: 10,
        canvas_bounds: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
        source: { type: "master_pixels", asset_path: "layers/back_hair.png" },
      },
      {
        id: "11111111-1111-4111-8111-111111111104",
        display_name: "body",
        semantic: "BODY",
        side: "CENTER",
        z_index: 20,
        canvas_bounds: { x: 0.2, y: 0.55, w: 0.6, h: 0.4 },
        source: { type: "master_pixels", asset_path: "layers/body.png" },
      },
      {
        id: "11111111-1111-4111-8111-111111111105",
        display_name: "arm L",
        semantic: "ARM",
        side: "LEFT",
        z_index: 15,
        canvas_bounds: { x: 0.05, y: 0.6, w: 0.25, h: 0.35 },
        source: { type: "master_pixels", asset_path: "layers/arm_l.png" },
      },
    ];

    await writeFile(
      path.join(dir, "spec/layer_manifest.json"),
      JSON.stringify({
        id: "22222222-2222-4222-8222-222222222201",
        version: "0.1",
        character_id: "33333333-3333-4333-8333-333333333301",
        canvas: { width: w, height: h },
        layers,
        occlusion_edges: [],
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

  it("writes masks + completion PNGs with completion_method", async () => {
    const { outputs, reportPath } = await completeOcclusionScenarios({
      projectRoot: dir,
      dryRun: true,
      forceLocalFallback: true,
    });
    expect(outputs.length).toBe(3);
    for (const o of outputs) {
      expect(o.completion_method).toBe("multi_scale_neighbor_blend");
      await access(path.join(dir, o.path));
      await access(path.join(dir, o.mask_path!));
      expect(o.prompt_hash).toMatch(/^[0-9a-f]{16}$/);
    }
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.scenarios).toHaveLength(3);
  }, 30_000);
});
