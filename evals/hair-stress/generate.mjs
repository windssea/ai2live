#!/usr/bin/env node
/**
 * Synthetic hair-stress fixture: dense front hair over face with a hidden forehead band.
 * Used to exercise Gate 2 / Gate 4 / occlusion completion pass-rate reporting.
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const W = 128;
const H = 160;

function blank() {
  return Buffer.alloc(W * H * 4, 0);
}

function fill(buf, x0, y0, x1, y1, rgba) {
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
}

await mkdir(path.join(root, "layers"), { recursive: true });
await mkdir(path.join(root, "design"), { recursive: true });
await mkdir(path.join(root, "spec"), { recursive: true });

const face = blank();
const front = blank();
const back = blank();
const body = blank();
const master = blank();

// back hair
fill(back, 20, 10, 108, 140, [40, 30, 55, 255]);
// face (forehead intentionally sparse under bangs region y=20..45)
fill(face, 36, 40, 92, 110, [240, 210, 190, 255]);
// dense bangs covering upper face
fill(front, 28, 12, 100, 55, [35, 25, 50, 255]);
// strand noise
for (let x = 30; x < 98; x += 3) {
  fill(front, x, 12, x + 1, 70, [20, 15, 35, 255]);
}
fill(body, 40, 100, 88, 155, [90, 130, 200, 255]);

// master = composite approx
for (let i = 0; i < master.length; i += 4) {
  // painter's algorithm: back, body, face, front
  for (const layer of [back, body, face, front]) {
    if (layer[i + 3] > 16) {
      master[i] = layer[i];
      master[i + 1] = layer[i + 1];
      master[i + 2] = layer[i + 2];
      master[i + 3] = 255;
    }
  }
}

async function save(name, buf) {
  await sharp(buf, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toFile(path.join(root, name));
}

await save("layers/back_hair.png", back);
await save("layers/face.png", face);
await save("layers/front_hair.png", front);
await save("layers/body.png", body);
await save("design/master_neutral.png", master);

const manifest = {
  id: "man_hair_stress",
  version: "0.1",
  character_id: "char_hair_stress",
  canvas: { width: W, height: H },
  layers: [
    {
      id: "layer_back_hair",
      display_name: "back_hair",
      semantic: "BACK_HAIR",
      side: "CENTER",
      z_index: 10,
      group: "BACK_HAIR",
      canvas_bounds: { x: 0.15, y: 0.05, w: 0.7, h: 0.8 },
      source: { type: "user_asset", asset_path: "layers/back_hair.png" },
      status: "READY",
    },
    {
      id: "layer_body",
      display_name: "body",
      semantic: "BODY",
      side: "CENTER",
      z_index: 20,
      group: "BODY",
      canvas_bounds: { x: 0.3, y: 0.6, w: 0.4, h: 0.35 },
      source: { type: "user_asset", asset_path: "layers/body.png" },
      status: "READY",
    },
    {
      id: "layer_face",
      display_name: "face",
      semantic: "FACE",
      side: "CENTER",
      z_index: 40,
      group: "FACE",
      canvas_bounds: { x: 0.25, y: 0.2, w: 0.5, h: 0.5 },
      source: { type: "user_asset", asset_path: "layers/face.png" },
      status: "READY",
      overlap: {
        required_with: ["layer_front_hair"],
        minimum_px_at_master_resolution: 8,
      },
    },
    {
      id: "layer_front_hair",
      display_name: "front_hair",
      semantic: "FRONT_HAIR",
      side: "CENTER",
      z_index: 50,
      group: "FRONT_HAIR",
      canvas_bounds: { x: 0.2, y: 0.05, w: 0.6, h: 0.4 },
      source: { type: "user_asset", asset_path: "layers/front_hair.png" },
      status: "READY",
    },
  ],
  occlusion_edges: [
    {
      id: "edge_bangs_face",
      occluder: "layer_front_hair",
      occludee: "layer_face",
    },
  ],
};

await writeFile(path.join(root, "spec/layer_manifest.json"), JSON.stringify(manifest, null, 2));
await writeFile(
  path.join(root, "spec/character.json"),
  JSON.stringify(
    {
      id: "char_hair_stress",
      version: "0.1",
      name: "Hair Stress Synthetic",
      notes: "Dense bangs over incomplete forehead — hair stress eval",
    },
    null,
    2
  )
);

console.log(`Wrote hair-stress fixture at ${root}`);
