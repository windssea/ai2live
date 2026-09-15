import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const W = 256, H = 256;

async function rectPng(file, x, y, w, h, rgba, canvasW = W, canvasH = H) {
  const buf = Buffer.alloc(canvasW * canvasH * 4, 0);
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (px < 0 || py < 0 || px >= canvasW || py >= canvasH) continue;
      const i = (py * canvasW + px) * 4;
      buf[i] = rgba[0]; buf[i+1] = rgba[1]; buf[i+2] = rgba[2]; buf[i+3] = rgba[3];
    }
  }
  const out = path.join(root, file);
  await mkdir(path.dirname(out), { recursive: true });
  await sharp(buf, { raw: { width: canvasW, height: canvasH, channels: 4 } }).png().toFile(out);
}

// Full-canvas transparent layers with opaque shapes (compose = master)
await rectPng("layers/back_hair.png", 64, 20, 128, 140, [90, 60, 160, 255]);
await rectPng("layers/body.png", 77, 115, 102, 128, [70, 130, 200, 255]);
await rectPng("layers/arm_l.png", 46, 123, 46, 90, [255, 200, 170, 255]);
await rectPng("layers/arm_r.png", 164, 123, 46, 90, [255, 200, 170, 255]);
await rectPng("layers/face.png", 82, 31, 92, 92, [255, 220, 190, 255]);
await rectPng("layers/eye_l.png", 97, 56, 26, 20, [40, 80, 160, 255]);
await rectPng("layers/eye_r.png", 133, 56, 26, 20, [40, 80, 160, 255]);
await rectPng("layers/mouth.png", 113, 92, 30, 15, [200, 80, 100, 255]);
await rectPng("layers/front_hair.png", 72, 13, 112, 72, [120, 80, 200, 255]);

// Master = composite of all (same as recompose). Build via sharp composite.
const layers = [
  "back_hair", "body", "arm_l", "arm_r", "face", "eye_l", "eye_r", "mouth", "front_hair"
];
const inputs = [];
for (const name of layers) {
  inputs.push({ input: path.join(root, "layers", `${name}.png`), blend: "over" });
}
await sharp({
  create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite(inputs)
  .png()
  .toFile(path.join(root, "design", "master_neutral.png"));

await writeFile(path.join(root, "README.md"), `# simple-character\n\nSynthetic M0 example. LEFT/RIGHT = character-own sides.\n\n\`\`\`bash\npnpm ai2live compile examples/simple-character\npnpm ai2live validate examples/simple-character\n\`\`\`\n`);
console.log("assets generated");
