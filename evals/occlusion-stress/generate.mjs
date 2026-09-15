#!/usr/bin/env node
/**
 * Synthetic occlusion-stress fixture:
 * bangs over incomplete forehead, face over incomplete back hair, body over arm root.
 * Runner compares completion opaque coverage vs see-through (visible-only) baseline.
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
await mkdir(path.join(root, "previews"), { recursive: true });

const face = blank();
const front = blank();
const back = blank();
const body = blank();
const arm = blank();
const master = blank();

// back hair — missing strip under face (x 40..88, y 30..90) to force completion
fill(back, 18, 8, 110, 145, [45, 32, 60, 255]);
fill(back, 40, 30, 88, 95, [0, 0, 0, 0]); // punch hole under face

// face — incomplete forehead band under bangs (y 20..42 sparse)
fill(face, 36, 42, 92, 112, [240, 210, 190, 255]);
// only a little forehead visible at sides
fill(face, 36, 28, 44, 42, [240, 210, 190, 200]);
fill(face, 84, 28, 92, 42, [240, 210, 190, 200]);

// dense bangs
fill(front, 28, 10, 100, 52, [35, 25, 50, 255]);
for (let x = 30; x < 98; x += 3) {
  fill(front, x, 10, x + 1, 68, [20, 15, 35, 255]);
}

// body
fill(body, 42, 100, 90, 155, [90, 130, 200, 255]);

// arm — missing root under body (y 95..115, x 30..50)
fill(arm, 28, 115, 48, 150, [240, 200, 180, 255]);
// intentional missing root pixels under body overlap
fill(arm, 32, 95, 52, 115, [0, 0, 0, 0]);

for (let i = 0; i < master.length; i += 4) {
  for (const layer of [back, body, arm, face, front]) {
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
await save("layers/arm_left.png", arm);
await save("design/master_neutral.png", master);

// see-through baseline = master with only visible composite (no completion)
await save("previews/see_through_baseline.png", master);

const character = {
  id: "char_occlusion_stress",
  name: "Occlusion Stress",
  version: "0.1",
  description: "Synthetic occlusion stress fixture",
  art_style: "flat anime blocks",
  canvas: { width: W, height: H },
};

const manifest = {
  id: "man_occlusion_stress",
  version: "0.1",
  character_id: "char_occlusion_stress",
  canvas: { width: W, height: H },
  layers: [
    {
      id: "layer_back_hair",
      display_name: "back_hair",
      semantic: "BACK_HAIR",
      side: "CENTER",
      z_index: 10,
      group: "BACK_HAIR",
      canvas_bounds: { x: 0.14, y: 0.05, w: 0.72, h: 0.85 },
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
      id: "layer_arm_left",
      display_name: "arm_left",
      semantic: "ARM",
      side: "LEFT",
      z_index: 25,
      group: "ARM",
      canvas_bounds: { x: 0.2, y: 0.58, w: 0.2, h: 0.35 },
      source: { type: "user_asset", asset_path: "layers/arm_left.png" },
      status: "READY",
      overlap: {
        required_with: ["layer_body"],
        minimum_px_at_master_resolution: 8,
      },
    },
    {
      id: "layer_face",
      display_name: "face",
      semantic: "FACE",
      side: "CENTER",
      z_index: 40,
      group: "FACE",
      canvas_bounds: { x: 0.25, y: 0.18, w: 0.5, h: 0.52 },
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
    { occluder: "layer_front_hair", occludee: "layer_face" },
    { occluder: "layer_face", occludee: "layer_back_hair" },
    { occluder: "layer_body", occludee: "layer_arm_left" },
  ],
};

await writeFile(path.join(root, "spec/character.json"), JSON.stringify(character, null, 2));
await writeFile(path.join(root, "spec/layer_manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`occlusion-stress fixture written at ${root}`);
