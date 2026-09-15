import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { compareSeeThroughVsCompletion, runAbCompare } from "./ab-metrics.js";

async function writeRgba(
  abs: string,
  w: number,
  h: number,
  fill: (x: number, y: number, i: number, buf: Buffer) => void
) {
  const buf = Buffer.alloc(w * h * 4, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) fill(x, y, (y * w + x) * 4, buf);
  }
  await mkdir(path.dirname(abs), { recursive: true });
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(abs);
}

describe("ab-metrics see-through vs completion", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ab-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prefers completion when hole is filled", async () => {
    const w = 16;
    const h = 16;
    const see = path.join(dir, "see.png");
    const done = path.join(dir, "done.png");
    const mask = path.join(dir, "mask.png");
    await writeRgba(see, w, h, (x, y, i, buf) => {
      if (x === 8 && y === 8) return; // hole
      buf[i] = 180;
      buf[i + 1] = 160;
      buf[i + 2] = 140;
      buf[i + 3] = 255;
    });
    await writeRgba(done, w, h, (x, y, i, buf) => {
      buf[i] = 180;
      buf[i + 1] = 160;
      buf[i + 2] = 140;
      buf[i + 3] = 255;
    });
    await writeRgba(mask, w, h, (x, y, i, buf) => {
      if (x === 8 && y === 8) buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 255;
    });
    const m = await compareSeeThroughVsCompletion({
      label: "hole",
      seeThroughPath: see,
      completionPath: done,
      maskPath: mask,
    });
    expect(m.alpha_recovery_rate).toBeGreaterThan(0.5);
    expect(m.prefer_completion).toBe(true);
    const r = await runAbCompare(
      [{ label: "hole", seeThroughPath: see, completionPath: done, maskPath: mask }],
      { writeReportPath: path.join(dir, "ab.json") }
    );
    expect(r.prefer_completion_count).toBe(1);
  });
});
