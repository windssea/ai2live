import sharp from "sharp";
import path from "node:path";
import type { LayerManifest, LayerNode } from "@ai2live/domain";

export interface LoadedLayer {
  layer: LayerNode;
  /** Full-canvas RGBA buffer */
  rgba: Buffer;
  width: number;
  height: number;
}

export async function loadLayerRgba(
  projectRoot: string,
  manifest: LayerManifest,
  layer: LayerNode
): Promise<LoadedLayer> {
  const { width, height } = manifest.canvas;
  const rel = layer.source.asset_path;
  if (!rel) {
    throw new Error(`Layer ${layer.id} missing source.asset_path`);
  }
  const abs = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
  const meta = await sharp(abs).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;

  // Full-canvas asset: use as-is (canvas_bounds are metadata only)
  if (srcW === width && srcH === height) {
    const { data } = await sharp(abs).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { layer, rgba: data, width, height };
  }

  // Cropped asset with canvas_bounds: place into full canvas
  if (layer.canvas_bounds) {
    const b = layer.canvas_bounds;
    const lw = Math.max(1, Math.round(b.w * width));
    const lh = Math.max(1, Math.round(b.h * height));
    const lx = Math.round(b.x * width);
    const ly = Math.round(b.y * height);
    const cropped = await sharp(abs)
      .ensureAlpha()
      .resize(lw, lh, { fit: "fill", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const canvas = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: cropped, left: Math.max(0, lx), top: Math.max(0, ly) }])
      .ensureAlpha()
      .raw()
      .toBuffer();
    return { layer, rgba: canvas, width, height };
  }

  // Fallback: scale to canvas
  const { data } = await sharp(abs)
    .ensureAlpha()
    .resize(width, height, {
      fit: "fill",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { layer, rgba: data, width, height };
}

/** Sort layers bottom→top for compositing (low z first). */
export function layersByZAsc(layers: LayerNode[]): LayerNode[] {
  return [...layers].sort((a, b) => a.z_index - b.z_index);
}

/** Sort layers top→bottom for PSD children (ag-psd: first child = top). */
export function layersByZDesc(layers: LayerNode[]): LayerNode[] {
  return [...layers].sort((a, b) => b.z_index - a.z_index);
}

export async function recomposeNeutral(
  projectRoot: string,
  manifest: LayerManifest
): Promise<{ png: Buffer; width: number; height: number }> {
  const { width, height } = manifest.canvas;
  const ordered = layersByZAsc(manifest.layers);
  const composites: sharp.OverlayOptions[] = [];
  for (const layer of ordered) {
    const loaded = await loadLayerRgba(projectRoot, manifest, layer);
    const png = await sharp(loaded.rgba, {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();
    composites.push({ input: png, left: 0, top: 0, blend: "over" });
  }
  const png = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
  return { png, width, height };
}
