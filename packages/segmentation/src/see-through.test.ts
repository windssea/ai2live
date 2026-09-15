import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { seeThroughFromMaster } from "./see-through.js";

const exampleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../examples/simple-character"
);

describe("see-through fallback", () => {
  it("writes masks for example project", async () => {
    const r = await seeThroughFromMaster({ projectRoot: exampleRoot });
    expect(r.masks.length).toBeGreaterThan(0);
    await access(path.join(exampleRoot, r.masks[0]!.path));
    expect(r.masks[0]!.stats).toBeDefined();
  });

  it("synthetic PNG: feather + bilateral + debug sheet", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ai2live-seg-"));
    try {
      const w = 64;
      const h = 64;
      await mkdir(path.join(dir, "spec"), { recursive: true });
      await mkdir(path.join(dir, "design"), { recursive: true });

      const master = Buffer.alloc(w * h * 4, 0);
      // two eye-like blobs
      for (let y = 20; y < 28; y++) {
        for (let x = 12; x < 22; x++) {
          const i = (y * w + x) * 4;
          master[i] = 200;
          master[i + 1] = 180;
          master[i + 2] = 160;
          master[i + 3] = 255;
        }
        for (let x = 42; x < 52; x++) {
          const i = (y * w + x) * 4;
          master[i] = 200;
          master[i + 1] = 180;
          master[i + 2] = 160;
          master[i + 3] = 255;
        }
      }
      await sharp(master, { raw: { width: w, height: h, channels: 4 } })
        .png()
        .toFile(path.join(dir, "design", "master_neutral.png"));

      const manifest = {
        id: "man_test",
        version: "0.1",
        character_id: "char_test",
        canvas: { width: w, height: h },
        layers: [
          {
            id: "layer_eye_l",
            display_name: "eye_l",
            semantic: "EYE",
            side: "LEFT",
            index: 1,
            z_index: 40,
            group: "EYES",
            canvas_bounds: { x: 0.1, y: 0.25, w: 0.8, h: 0.3 },
            source: { type: "master_pixels" },
            status: "DRAFT",
          },
          {
            id: "layer_eye_r",
            display_name: "eye_r",
            semantic: "EYE",
            side: "RIGHT",
            index: 1,
            z_index: 40,
            group: "EYES",
            canvas_bounds: { x: 0.1, y: 0.25, w: 0.8, h: 0.3 },
            source: { type: "master_pixels" },
            status: "DRAFT",
          },
        ],
      };
      await writeFile(
        path.join(dir, "spec", "layer_manifest.json"),
        JSON.stringify(manifest, null, 2)
      );

      const r = await seeThroughFromMaster({
        projectRoot: dir,
        feather: 2,
        splitBilateral: true,
        debug: true,
      });
      expect(r.masks.length).toBe(2);
      expect(r.debugPath).toBeTruthy();
      await access(r.debugPath!);
      await access(path.join(dir, "previews", "seg_debug.png"));
      const report = JSON.parse(await readFile(r.reportPath, "utf8"));
      expect(report.qc.mask_coverage.length).toBe(2);
      expect(report.options.feather).toBe(2);
      expect(report.options.splitBilateral).toBe(true);
      // both sides should have some coverage after split
      expect(r.masks.every((m) => m.stats.opaque_px > 0)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
