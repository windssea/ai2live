import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { minRegionInpaint, neighborBlendFiles } from "./inpaint.js";

async function writeRgba(abs: string, w: number, h: number, fill: (x: number, y: number, i: number, buf: Buffer) => void) {
  const buf = Buffer.alloc(w * h * 4, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fill(x, y, (y * w + x) * 4, buf);
    }
  }
  await mkdir(path.dirname(abs), { recursive: true });
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(abs);
}

describe("minRegionInpaint (offline synthetic masks)", () => {
  const ENV_KEYS = ["AI2LIVE_MODEL_DRY_RUN", "AI2LIVE_IMAGE_WORKER_URL", "AI2LIVE_MODEL_PROVIDER"] as const;
  const saved: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-inpaint-"));
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("neighborBlendFiles fills masked hole from neighbors", async () => {
    const w = 16;
    const h = 16;
    const img = path.join(dir, "img.png");
    const mask = path.join(dir, "mask.png");
    const out = path.join(dir, "out.png");
    await writeRgba(img, w, h, (x, y, i, buf) => {
      if (x <= 5) {
        buf[i] = 200;
        buf[i + 1] = 40;
        buf[i + 2] = 40;
        buf[i + 3] = 255;
      }
    });
    await writeRgba(mask, w, h, (x, y, i, buf) => {
      if (x === 6 && y === 8) {
        buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 255;
      }
    });
    await neighborBlendFiles({ imagePath: img, maskPath: mask, outputPath: out });
    const raw = await sharp(out).ensureAlpha().raw().toBuffer();
    const i = (8 * w + 6) * 4;
    expect(raw[i + 3]!).toBeGreaterThan(150);
    expect(raw[i]!).toBeGreaterThan(100); // reddish from left neighbors
  });

  it("minRegionInpaint dry-run without worker → neighbor_blend", async () => {
    const w = 12;
    const h = 12;
    const img = path.join(dir, "img.png");
    const mask = path.join(dir, "mask.png");
    const out = path.join(dir, "filled.png");
    await writeRgba(img, w, h, (x, y, i, buf) => {
      buf[i] = 180;
      buf[i + 1] = 160;
      buf[i + 2] = 140;
      buf[i + 3] = x === 5 && y === 5 ? 0 : 255;
    });
    await writeRgba(mask, w, h, (x, y, i, buf) => {
      if (x === 5 && y === 5) buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 255;
    });
    const r = await minRegionInpaint({
      imagePath: img,
      maskPath: mask,
      outputPath: out,
      projectRoot: dir,
      forceLocal: true,
      dryRun: true,
    });
    expect(r.completion_method).toBe("neighbor_blend");
    await access(out);
  });
});
