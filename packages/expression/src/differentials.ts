import sharp from "sharp";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { LayerManifest } from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";

export type ExpressionKind = "mouth_open" | "eye_close" | "smile" | "special_eye";

/**
 * M3: full-character differential stubs.
 * Start from master_neutral and apply deterministic pixel edits in face ROIs
 * (not isolated icons) — matching AutoLive2d full-character differential rule.
 */
export async function generateExpressionDifferentials(opts: {
  projectRoot: string;
  kinds?: ExpressionKind[];
}): Promise<{ differentials: { kind: ExpressionKind; path: string }[] }> {
  const root = path.resolve(opts.projectRoot);
  const kinds = opts.kinds ?? ["mouth_open", "eye_close", "smile", "special_eye"];
  const masterPath = path.join(root, "design", "master_neutral.png");
  const manifest = assertLayerManifest(
    JSON.parse(await readFile(path.join(root, "spec", "layer_manifest.json"), "utf8"))
  ) as LayerManifest;
  const { width, height } = manifest.canvas;
  const outDir = path.join(root, "design", "differentials");
  await mkdir(outDir, { recursive: true });

  const mouth = manifest.layers.find((l) => l.semantic === "MOUTH");
  const eyeL = manifest.layers.find((l) => l.semantic === "EYE" && l.side === "LEFT");
  const eyeR = manifest.layers.find((l) => l.semantic === "EYE" && l.side === "RIGHT");

  const differentials: { kind: ExpressionKind; path: string }[] = [];

  for (const kind of kinds) {
    let img = await sharp(masterPath).ensureAlpha().resize(width, height).raw().toBuffer();
    img = Buffer.from(img);

    if (kind === "mouth_open" && mouth?.canvas_bounds) {
      fillRect(img, width, mouth.canvas_bounds, [40, 20, 30, 255], height);
      // inner mouth
      const b = mouth.canvas_bounds;
      fillRect(
        img,
        width,
        { x: b.x + 0.02, y: b.y + 0.01, w: b.w - 0.04, h: b.h - 0.01 },
        [180, 60, 80, 255],
        height
      );
    } else if (kind === "eye_close") {
      for (const eye of [eyeL, eyeR]) {
        if (!eye?.canvas_bounds) continue;
        fillRect(img, width, eye.canvas_bounds, [255, 220, 190, 255], height);
        // thin lash line
        const b = eye.canvas_bounds;
        fillRect(
          img,
          width,
          { x: b.x, y: b.y + b.h * 0.45, w: b.w, h: b.h * 0.15 },
          [40, 40, 50, 255],
          height
        );
      }
    } else if (kind === "smile" && mouth?.canvas_bounds) {
      const b = mouth.canvas_bounds;
      fillRect(img, width, b, [255, 220, 190, 255], height);
      // curved smile approx as thicker lower band
      fillRect(
        img,
        width,
        { x: b.x, y: b.y + b.h * 0.4, w: b.w, h: b.h * 0.35 },
        [200, 80, 100, 255],
        height
      );
    } else if (kind === "special_eye") {
      for (const eye of [eyeL, eyeR]) {
        if (!eye?.canvas_bounds) continue;
        fillRect(img, width, eye.canvas_bounds, [220, 40, 180, 255], height);
      }
    }

    const rel = path.posix.join("design/differentials", `${kind}.png`);
    await sharp(img, { raw: { width, height, channels: 4 } }).png().toFile(path.join(root, rel));
    differentials.push({ kind, path: rel });
  }

  await writeFile(
    path.join(outDir, "expression_report.json"),
    JSON.stringify(
      {
        version: "0.1",
        rule: "full_character_differential",
        differentials,
        note: "M3 stubs. Production should use image-edit with identity lock prompts.",
      },
      null,
      2
    )
  );

  return { differentials };
}

function fillRect(
  img: Buffer,
  width: number,
  b: { x: number; y: number; w: number; h: number },
  rgba: [number, number, number, number],
  height: number
) {
  const x0 = Math.round(b.x * width);
  const y0 = Math.round(b.y * height);
  const x1 = Math.round((b.x + b.w) * width);
  const y1 = Math.round((b.y + b.h) * height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      img[i] = rgba[0];
      img[i + 1] = rgba[1];
      img[i + 2] = rgba[2];
      img[i + 3] = rgba[3];
    }
  }
}
