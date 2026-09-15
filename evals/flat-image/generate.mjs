#!/usr/bin/env node
/**
 * Generate 1–2 flat character PNGs for --from-image dry-run eval.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root, "images"), { recursive: true });

async function makeFlat(name, palette) {
  const W = 96;
  const H = 128;
  const buf = Buffer.alloc(W * H * 4, 0);
  const fill = (x0, y0, x1, y1, rgba) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        buf[i] = rgba[0];
        buf[i + 1] = rgba[1];
        buf[i + 2] = rgba[2];
        buf[i + 3] = rgba[3];
      }
    }
  };
  // hair
  fill(20, 8, 76, 50, palette.hair);
  // face
  fill(28, 28, 68, 70, palette.skin);
  // body
  fill(30, 70, 66, 120, palette.body);
  // eyes
  fill(36, 40, 42, 46, [30, 30, 40, 255]);
  fill(54, 40, 60, 46, [30, 30, 40, 255]);
  await sharp(buf, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(path.join(root, "images", name));
}

await makeFlat("flat_a.png", {
  hair: [40, 30, 70, 255],
  skin: [245, 215, 195, 255],
  body: [80, 140, 210, 255],
});
await makeFlat("flat_b.png", {
  hair: [90, 40, 40, 255],
  skin: [250, 220, 200, 255],
  body: [200, 100, 140, 255],
});
console.log(`flat images written under ${path.join(root, "images")}`);
