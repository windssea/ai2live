import sharp from "sharp";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { LayerManifest, LayerNode } from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";
import {
  featherMask,
  keepLargestComponent,
  maskCoverage,
  morphClose,
  thresholdMask,
  isBilateralSemantic,
  findSplitColumn,
  splitBySide,
  type MaskStats,
} from "./mask-ops.js";

export interface SeeThroughOptions {
  projectRoot: string;
  masterPath?: string;
  manifestPath?: string;
  outMaskDir?: string;
  /** Alpha threshold 0-255 (default 8). */
  alphaThreshold?: number;
  /** Soft edge radius in px (0 = hard). Also enables mild morph close. */
  feather?: number;
  /** Split bilateral semantics (eyes/arms) to LEFT/RIGHT via center/valley. */
  splitBilateral?: boolean;
  /** Write previews/seg_debug.png collage. */
  debug?: boolean;
  /** Keep largest connected component inside ROI (default true). */
  keepLargest?: boolean;
}

export interface SegmentMaskResult {
  layerId: string;
  path: string;
  stats: MaskStats;
  split?: boolean;
}

/**
 * See-through segmentation: ROI from canvas_bounds ∩ master alpha, then
 * threshold → connected-component cleanup → optional feather / bilateral split.
 */
export async function seeThroughFromMaster(opts: SeeThroughOptions): Promise<{
  masks: SegmentMaskResult[];
  outLayers: string[];
  reportPath: string;
  debugPath?: string;
}> {
  const root = path.resolve(opts.projectRoot);
  const manifestPath = opts.manifestPath ?? path.join(root, "spec", "layer_manifest.json");
  const masterPath = opts.masterPath ?? path.join(root, "design", "master_neutral.png");
  const outMaskDir = opts.outMaskDir ?? path.join(root, "masks");
  const alphaThreshold = opts.alphaThreshold ?? 8;
  const feather = Math.max(0, Math.floor(opts.feather ?? 0));
  const splitBilateral = Boolean(opts.splitBilateral);
  const keepLargest = opts.keepLargest !== false;
  const debug = Boolean(opts.debug);

  await mkdir(outMaskDir, { recursive: true });

  const manifest = assertLayerManifest(
    JSON.parse(await readFile(manifestPath, "utf8"))
  ) as LayerManifest;
  const { width, height } = manifest.canvas;
  const master = await sharp(masterPath).ensureAlpha().resize(width, height).raw().toBuffer();

  const masks: SegmentMaskResult[] = [];
  const outLayers: string[] = [];
  const debugTiles: { title: string; rgba: Buffer }[] = [];

  // Global split column from full master alpha (stable across layers)
  const globalSplit = splitBilateral
    ? findSplitColumn(master, width, height, alphaThreshold)
    : Math.floor(width / 2);

  for (const layer of manifest.layers) {
    let maskBuf: Buffer = Buffer.alloc(width * height * 4, 0);
    const layerBuf = Buffer.alloc(width * height * 4, 0);
    const b = layer.canvas_bounds;
    const x0 = b ? Math.round(b.x * width) : 0;
    const y0 = b ? Math.round(b.y * height) : 0;
    const x1 = b ? Math.round((b.x + b.w) * width) : width;
    const y1 = b ? Math.round((b.y + b.h) * height) : height;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        const a = master[i + 3]!;
        if (a < alphaThreshold) continue;
        maskBuf[i] = 255;
        maskBuf[i + 1] = 255;
        maskBuf[i + 2] = 255;
        maskBuf[i + 3] = 255;
        layerBuf[i] = master[i]!;
        layerBuf[i + 1] = master[i + 1]!;
        layerBuf[i + 2] = master[i + 2]!;
        layerBuf[i + 3] = a;
      }
    }

    // Threshold → optional bilateral split → largest CC → feather
    // (split before CC so LEFT/RIGHT halves are not discarded as "small" components)
    maskBuf = Buffer.from(thresholdMask(maskBuf, width, height, alphaThreshold));

    let didSplit = false;
    if (
      splitBilateral &&
      isBilateralSemantic(layer.semantic) &&
      (layer.side === "LEFT" || layer.side === "RIGHT")
    ) {
      maskBuf = Buffer.from(
        splitBySide(maskBuf, width, height, layer.side, globalSplit, alphaThreshold)
      );
      didSplit = true;
    }

    if (keepLargest) {
      maskBuf = Buffer.from(keepLargestComponent(maskBuf, width, height, alphaThreshold));
    }

    // Mild close before feather to seal holes
    if (feather > 0) {
      const r = Math.max(1, Math.min(2, feather));
      maskBuf = Buffer.from(morphClose(maskBuf, width, height, r, alphaThreshold));
      maskBuf = Buffer.from(featherMask(maskBuf, width, height, feather, alphaThreshold));
    }

    if (didSplit) {
      for (let i = 0; i < layerBuf.length; i += 4) {
        if ((maskBuf[i + 3] ?? 0) < alphaThreshold && (maskBuf[i] ?? 0) < alphaThreshold) {
          layerBuf[i] = layerBuf[i + 1] = layerBuf[i + 2] = layerBuf[i + 3] = 0;
        }
      }
    }

    // Apply mask alpha to layer extract
    for (let i = 0; i < layerBuf.length; i += 4) {
      const ma = Math.max(maskBuf[i + 3] ?? 0, maskBuf[i] ?? 0);
      if (ma < alphaThreshold) {
        layerBuf[i + 3] = 0;
      } else if (feather > 0) {
        layerBuf[i + 3] = Math.min(layerBuf[i + 3]!, ma);
      }
    }

    const stats = maskCoverage(maskBuf, width, height, alphaThreshold);
    const maskRel = path.posix.join("masks", `${slug(layer)}.png`);
    const maskAbs = path.join(root, maskRel);
    await sharp(maskBuf, { raw: { width, height, channels: 4 } }).png().toFile(maskAbs);
    masks.push({ layerId: layer.id, path: maskRel, stats, split: didSplit || undefined });

    const draftDir = path.join(root, "masks", "see_through_layers");
    await mkdir(draftDir, { recursive: true });
    const draftName = `${slug(layer)}.png`;
    await sharp(layerBuf, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(path.join(draftDir, draftName));
    outLayers.push(path.posix.join("masks/see_through_layers", draftName));

    if (debug) {
      debugTiles.push({ title: slug(layer), rgba: Buffer.from(maskBuf) });
    }
  }

  const coverageSummary = masks.map((m) => ({
    layerId: m.layerId,
    path: m.path,
    opaque_px: m.stats.opaque_px,
    coverage: Number(m.stats.coverage.toFixed(6)),
    bbox: m.stats.bbox,
    split: m.split ?? false,
  }));

  const reportPath = path.join(outMaskDir, "segmentation_report.json");
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        method: "see_through_v2",
        master: path.relative(root, masterPath),
        options: {
          alphaThreshold,
          feather,
          splitBilateral,
          keepLargest,
          debug,
          splitColumn: splitBilateral ? globalSplit : undefined,
        },
        masks: coverageSummary,
        draft_layers: outLayers,
        qc: {
          mask_coverage: coverageSummary,
          mean_coverage:
            coverageSummary.length === 0
              ? 0
              : coverageSummary.reduce((s, m) => s + m.coverage, 0) / coverageSummary.length,
          empty_masks: coverageSummary.filter((m) => m.opaque_px === 0).map((m) => m.layerId),
        },
        note: "See-through with alpha threshold, connected components, optional feather & bilateral split.",
      },
      null,
      2
    )
  );

  let debugPath: string | undefined;
  if (debug) {
    debugPath = await writeDebugSheet({
      root,
      width,
      height,
      master,
      tiles: debugTiles,
      splitColumn: splitBilateral ? globalSplit : undefined,
    });
  }

  return { masks, outLayers, reportPath, debugPath };
}

async function writeDebugSheet(opts: {
  root: string;
  width: number;
  height: number;
  master: Buffer;
  tiles: { title: string; rgba: Buffer }[];
  splitColumn?: number;
}): Promise<string> {
  const { root, width, height, master, tiles, splitColumn } = opts;
  const previewDir = path.join(root, "previews");
  await mkdir(previewDir, { recursive: true });
  const outPath = path.join(previewDir, "seg_debug.png");

  const cols = Math.min(4, Math.max(1, tiles.length + 1));
  const rows = Math.ceil((tiles.length + 1) / cols);
  const cellW = width;
  const cellH = height;
  const sheetW = cols * cellW;
  const sheetH = rows * cellH;
  const sheet = Buffer.alloc(sheetW * sheetH * 4, 30);

  const blit = (src: Buffer, col: number, row: number, drawSplit = false) => {
    const ox = col * cellW;
    const oy = row * cellH;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const si = (y * width + x) * 4;
        const di = ((oy + y) * sheetW + (ox + x)) * 4;
        sheet[di] = src[si]!;
        sheet[di + 1] = src[si + 1]!;
        sheet[di + 2] = src[si + 2]!;
        sheet[di + 3] = 255;
      }
    }
    if (drawSplit && splitColumn !== undefined) {
      const x = ox + splitColumn;
      for (let y = oy; y < oy + height; y++) {
        const di = (y * sheetW + x) * 4;
        sheet[di] = 255;
        sheet[di + 1] = 64;
        sheet[di + 2] = 64;
        sheet[di + 3] = 255;
      }
    }
  };

  // Tile 0: master
  blit(master, 0, 0, true);
  tiles.forEach((t, i) => {
    const idx = i + 1;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    blit(t.rgba, col, row, false);
  });

  await sharp(sheet, { raw: { width: sheetW, height: sheetH, channels: 4 } })
    .png()
    .toFile(outPath);
  return outPath;
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
    masks: r.masks.map((m) => ({ layerId: m.layerId, path: m.path, method: "stub_bbox" })),
  };
}
