import sharp from "sharp";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { LayerManifest, LayerNode } from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";

/**
 * See-through fallback: for each layer with canvas_bounds, extract master pixels
 * inside bounds (alpha from non-transparent master in that ROI) as a mask + layer draft.
 * This is the M1 baseline without ML segmentation.
 */
export async function seeThroughFromMaster(opts: {
  projectRoot: string;
  masterPath?: string;
  manifestPath?: string;
  outMaskDir?: string;
}): Promise<{ masks: { layerId: string; path: string }[]; outLayers: string[] }> {
  const root = path.resolve(opts.projectRoot);
  const manifestPath = opts.manifestPath ?? path.join(root, "spec", "layer_manifest.json");
  const masterPath = opts.masterPath ?? path.join(root, "design", "master_neutral.png");
  const outMaskDir = opts.outMaskDir ?? path.join(root, "masks");
  await mkdir(outMaskDir, { recursive: true });

  const manifest = assertLayerManifest(
    JSON.parse(await readFile(manifestPath, "utf8"))
  ) as LayerManifest;
  const { width, height } = manifest.canvas;
  const master = await sharp(masterPath).ensureAlpha().resize(width, height).raw().toBuffer();

  const masks: { layerId: string; path: string }[] = [];
  const outLayers: string[] = [];

  for (const layer of manifest.layers) {
    const maskBuf = Buffer.alloc(width * height * 4, 0);
    const layerBuf = Buffer.alloc(width * height * 4, 0);
    const b = layer.canvas_bounds;
    const x0 = b ? Math.round(b.x * width) : 0;
    const y0 = b ? Math.round(b.y * height) : 0;
    const x1 = b ? Math.round((b.x + b.w) * width) : width;
    const y1 = b ? Math.round((b.y + b.h) * height) : height;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        const a = master[i + 3];
        if (a < 8) continue;
        // Mask = white where we claim this layer owns pixels (bbox ∩ opaque master)
        maskBuf[i] = 255;
        maskBuf[i + 1] = 255;
        maskBuf[i + 2] = 255;
        maskBuf[i + 3] = 255;
        // See-through extract: copy master pixels (visible only)
        layerBuf[i] = master[i];
        layerBuf[i + 1] = master[i + 1];
        layerBuf[i + 2] = master[i + 2];
        layerBuf[i + 3] = a;
      }
    }

    const maskRel = path.posix.join("masks", `${slug(layer)}.png`);
    const maskAbs = path.join(root, maskRel);
    await sharp(maskBuf, { raw: { width, height, channels: 4 } }).png().toFile(maskAbs);
    masks.push({ layerId: layer.id, path: maskRel });

    // Optional draft under masks/see_through_layers — does not overwrite hand layers by default
    const draftDir = path.join(root, "masks", "see_through_layers");
    await mkdir(draftDir, { recursive: true });
    const draftName = `${slug(layer)}.png`;
    await sharp(layerBuf, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(path.join(draftDir, draftName));
    outLayers.push(path.posix.join("masks/see_through_layers", draftName));
  }

  await writeFile(
    path.join(outMaskDir, "segmentation_report.json"),
    JSON.stringify(
      {
        method: "see_through",
        master: path.relative(root, masterPath),
        masks,
        draft_layers: outLayers,
        note: "M1 see-through fallback using canvas_bounds ∩ master alpha. Replace with ML segmenter later.",
      },
      null,
      2
    )
  );

  return { masks, outLayers };
}

function slug(layer: LayerNode): string {
  return `${layer.semantic.toLowerCase()}_${layer.side.toLowerCase()}_${layer.index ?? 1}`;
}

/** Stub ML segmenter — returns bbox masks only, labeled as stub_bbox */
export async function stubSegment(opts: {
  projectRoot: string;
  manifestPath?: string;
}): Promise<{ masks: { layerId: string; path: string; method: string }[] }> {
  const r = await seeThroughFromMaster(opts);
  return {
    masks: r.masks.map((m) => ({ ...m, method: "stub_bbox" })),
  };
}
