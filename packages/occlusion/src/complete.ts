import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import type { LayerManifest } from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";
import {
  createProvider,
  resolveProviderId,
  type ModelProvider,
  type ProviderId,
} from "@ai2live/model-providers";
import { minRegionInpaint } from "@ai2live/image-client";
import { writeOcclusionGraph, enrichOcclusionEdges } from "./graph.js";
import {
  buildLayeredPrompt,
  occlusionEditDelta,
} from "@ai2live/prompt-layers";

export type OcclusionScenario = "bangs_under_face" | "face_over_back_hair" | "body_over_arm_root";

/** Canonical DoD provenance (+ legacy aliases kept for readers). */
export type CompletionMethod =
  | "image_edit"
  | "opencv_inpaint"
  | "neighbor_blend"
  | "provider_image_edit" // legacy
  | "multi_scale_neighbor_blend" // legacy
  | "deterministic_dilate_fill"; // legacy

export interface CompletionMaskResult {
  /** Full-canvas RGBA mask (white = complete here). */
  maskRgba: Buffer;
  width: number;
  height: number;
  opaque_px: number;
  /** Relative path when written. */
  maskPath?: string;
}

export interface OcclusionScenarioResult {
  scenario: OcclusionScenario;
  path: string;
  mask_path?: string;
  completion_method: CompletionMethod;
  prompt_hash?: string;
  note?: string;
}

/**
 * Build DESIGN-aligned completion mask:
 *   completion = dilate(occluder_alpha) ∩ (occludee_alpha < threshold)
 */
export function buildCompletionMask(opts: {
  width: number;
  height: number;
  occluderRgba: Buffer;
  occludeeRgba: Buffer;
  region?: { x0: number; y0: number; x1: number; y1: number };
  dilateRadius?: number;
  missingThreshold?: number;
  occluderThreshold?: number;
}): CompletionMaskResult {
  const {
    width,
    height,
    occluderRgba,
    occludeeRgba,
    dilateRadius = 6,
    missingThreshold = 16,
    occluderThreshold = 24,
  } = opts;

  const occluderBin = Buffer.alloc(width * height);
  for (let i = 0, p = 0; i < occluderRgba.length; i += 4, p++) {
    occluderBin[p] = occluderRgba[i + 3]! >= occluderThreshold ? 1 : 0;
  }

  let dilated = occluderBin;
  const r = Math.max(1, dilateRadius);
  for (let pass = 0; pass < r; pass++) {
    const next = Buffer.alloc(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (dilated[ny * width + nx]) {
              on = 1;
              break;
            }
          }
        }
        next[y * width + x] = on;
      }
    }
    dilated = next;
  }

  const maskRgba = Buffer.alloc(width * height * 4, 0);
  let opaque = 0;
  const x0 = opts.region?.x0 ?? 0;
  const y0 = opts.region?.y0 ?? 0;
  const x1 = opts.region?.x1 ?? width;
  const y1 = opts.region?.y1 ?? height;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      const i = p * 4;
      const missing = occludeeRgba[i + 3]! < missingThreshold;
      if (dilated[p] && missing) {
        maskRgba[i] = maskRgba[i + 1] = maskRgba[i + 2] = maskRgba[i + 3] = 255;
        opaque += 1;
      }
    }
  }

  return { maskRgba, width, height, opaque_px: opaque };
}

/**
 * Fallback completion: multi-scale neighbor sampling + soft edge blend.
 */
export function neighborBlendComplete(opts: {
  width: number;
  height: number;
  baseRgba: Buffer;
  maskRgba: Buffer;
}): Buffer {
  const { width, height, baseRgba, maskRgba } = opts;
  const out = Buffer.from(baseRgba);
  const radii = [2, 4, 8, 16, 32];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (maskRgba[i + 3]! < 128) continue;

      let found = false;
      let sr = 0,
        sg = 0,
        sb = 0,
        sw = 0;
      for (const rad of radii) {
        sr = sg = sb = sw = 0;
        for (let dy = -rad; dy <= rad; dy++) {
          for (let dx = -rad; dx <= rad; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = (ny * width + nx) * 4;
            if (baseRgba[ni + 3]! < 200) continue;
            if (maskRgba[ni + 3]! >= 128 && (dx !== 0 || dy !== 0)) continue;
            const dist = Math.hypot(dx, dy) || 0.5;
            const w = 1 / dist;
            sr += baseRgba[ni]! * w;
            sg += baseRgba[ni + 1]! * w;
            sb += baseRgba[ni + 2]! * w;
            sw += w;
          }
        }
        if (sw > 0) {
          found = true;
          break;
        }
      }

      if (found && sw > 0) {
        out[i] = Math.round(sr / sw);
        out[i + 1] = Math.round(sg / sw);
        out[i + 2] = Math.round(sb / sw);
        out[i + 3] = 230;
      } else {
        let tr = 0,
          tg = 0,
          tb = 0,
          tn = 0;
        for (let dy = -24; dy <= 24; dy += 2) {
          for (let dx = -24; dx <= 24; dx += 2) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = (ny * width + nx) * 4;
            if (baseRgba[ni + 3]! > 200) {
              tr += baseRgba[ni]!;
              tg += baseRgba[ni + 1]!;
              tb += baseRgba[ni + 2]!;
              tn++;
            }
          }
        }
        out[i] = tn ? Math.round(tr / tn) : 255;
        out[i + 1] = tn ? Math.round(tg / tn) : 220;
        out[i + 2] = tn ? Math.round(tb / tn) : 190;
        out[i + 3] = 200;
      }
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    const snap = Buffer.from(out);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        if (maskRgba[i + 3]! < 128) continue;
        let border = false;
        for (let dy = -1; dy <= 1 && !border; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const mi = ((y + dy) * width + (x + dx)) * 4;
            if (maskRgba[mi + 3]! < 128) border = true;
          }
        }
        if (!border) continue;
        let sr = 0,
          sg = 0,
          sb = 0,
          sa = 0,
          n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ni = ((y + dy) * width + (x + dx)) * 4;
            sr += snap[ni]!;
            sg += snap[ni + 1]!;
            sb += snap[ni + 2]!;
            sa += snap[ni + 3]!;
            n++;
          }
        }
        out[i] = Math.round(0.45 * snap[i]! + 0.55 * (sr / n));
        out[i + 1] = Math.round(0.45 * snap[i + 1]! + 0.55 * (sg / n));
        out[i + 2] = Math.round(0.45 * snap[i + 2]! + 0.55 * (sb / n));
        out[i + 3] = Math.max(snap[i + 3]!, Math.round(0.7 * snap[i + 3]! + 0.3 * (sa / n)));
      }
    }
  }

  return out;
}

function promptForScenario(scenario: OcclusionScenario): string {
  return buildLayeredPrompt({
    editDelta: occlusionEditDelta(scenario),
  }).combined;
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

async function loadLayerOrEmpty(
  root: string,
  rel: string | undefined,
  width: number,
  height: number
): Promise<Buffer | null> {
  if (!rel) return null;
  const abs = path.join(root, rel);
  try {
    await access(abs);
  } catch {
    return null;
  }
  return sharp(abs).ensureAlpha().resize(width, height).raw().toBuffer();
}

/**
 * M2 occlusion completion — prefers min-region inpaint:
 * 1) Build completion mask = occluder dilated ∩ missing under-layer
 * 2) minRegionInpaint → image_edit | opencv_inpaint | neighbor_blend
 */
export async function completeOcclusionScenarios(opts: {
  projectRoot: string;
  scenarios?: OcclusionScenario[];
  provider?: ModelProvider | ProviderId | string;
  forceLocalFallback?: boolean;
  dryRun?: boolean;
}): Promise<{
  outputs: OcclusionScenarioResult[];
  reportPath: string;
}> {
  const root = path.resolve(opts.projectRoot);
  if (opts.dryRun) process.env.AI2LIVE_MODEL_DRY_RUN = "1";

  const scenarios = opts.scenarios ?? [
    "bangs_under_face",
    "face_over_back_hair",
    "body_over_arm_root",
  ];
  const manifest = assertLayerManifest(
    JSON.parse(await readFile(path.join(root, "spec", "layer_manifest.json"), "utf8"))
  ) as LayerManifest;
  const { width, height } = manifest.canvas;
  const outDir = path.join(root, "layers", "completions");
  const maskDir = path.join(outDir, "masks");
  await mkdir(maskDir, { recursive: true });

  let providerId: string | undefined;
  if (typeof opts.provider === "string") {
    providerId = opts.provider;
  } else if (typeof opts.provider === "object" && opts.provider && "id" in opts.provider) {
    providerId = opts.provider.id;
  } else if (!opts.forceLocalFallback) {
    try {
      providerId = resolveProviderId();
      createProvider(providerId, { cwd: root });
    } catch {
      providerId = undefined;
    }
  }

  const bySemantic = (sem: string, side?: string) =>
    manifest.layers.find(
      (l) =>
        l.semantic.toUpperCase().includes(sem) && (side ? l.side === side : true)
    );

  const outputs: OcclusionScenarioResult[] = [];

  for (const scenario of scenarios) {
    let occluder = bySemantic("FRONT_HAIR");
    let occludee = bySemantic("FACE");
    if (scenario === "face_over_back_hair") {
      occluder = bySemantic("FACE");
      occludee = bySemantic("BACK_HAIR");
    } else if (scenario === "body_over_arm_root") {
      occluder = bySemantic("BODY");
      occludee = bySemantic("ARM", "LEFT") ?? bySemantic("ARM");
    }
    if (!occluder || !occludee || !occludee.source.asset_path) continue;

    const occludeeRgba = await loadLayerOrEmpty(root, occludee.source.asset_path, width, height);
    if (!occludeeRgba) continue;

    let occluderRgba = await loadLayerOrEmpty(root, occluder.source.asset_path, width, height);
    if (!occluderRgba) {
      occluderRgba = Buffer.alloc(width * height * 4, 0);
      const b = occluder.canvas_bounds;
      if (b) {
        const x0 = Math.round(b.x * width);
        const y0 = Math.round(b.y * height);
        const x1 = Math.round((b.x + b.w) * width);
        const y1 = Math.round((b.y + b.h) * height);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const i = (y * width + x) * 4;
            occluderRgba[i] = occluderRgba[i + 1] = occluderRgba[i + 2] = 255;
            occluderRgba[i + 3] = 255;
          }
        }
      }
    }

    const region = occluder.canvas_bounds
      ? {
          x0: Math.max(0, Math.round(occluder.canvas_bounds.x * width) - 8),
          y0: Math.max(0, Math.round(occluder.canvas_bounds.y * height) - 8),
          x1: Math.min(
            width,
            Math.round((occluder.canvas_bounds.x + occluder.canvas_bounds.w) * width) + 8
          ),
          y1: Math.min(
            height,
            Math.round((occluder.canvas_bounds.y + occluder.canvas_bounds.h) * height) + 8
          ),
        }
      : undefined;

    const mask = buildCompletionMask({
      width,
      height,
      occluderRgba,
      occludeeRgba,
      region,
      dilateRadius: 6,
    });

    const maskRel = path.posix.join("layers/completions/masks", `${scenario}_mask.png`);
    await sharp(mask.maskRgba, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(path.join(root, maskRel));
    mask.maskPath = maskRel;

    const prompt = promptForScenario(scenario);
    const prompt_hash = hashPrompt(prompt);
    const outRel = path.posix.join("layers/completions", `${scenario}.png`);
    const outAbs = path.join(root, outRel);

    const tmpIn = path.join(outDir, `._${scenario}_input.png`);
    await sharp(occludeeRgba, { raw: { width, height, channels: 4 } }).png().toFile(tmpIn);

    const painted = await minRegionInpaint({
      imagePath: tmpIn,
      maskPath: path.join(root, maskRel),
      outputPath: outAbs,
      projectRoot: root,
      prompt,
      provider: providerId,
      forceLocal: Boolean(opts.forceLocalFallback),
      dryRun: opts.dryRun,
    });

    outputs.push({
      scenario,
      path: outRel,
      mask_path: maskRel,
      completion_method: painted.completion_method,
      prompt_hash,
      note: painted.note,
    });
  }

  // Persist richer occlusion graph (DESIGN)
  try {
    const manPath = path.join(root, "spec", "layer_manifest.json");
    const man = JSON.parse(await readFile(manPath, "utf8")) as LayerManifest;
    const edges = enrichOcclusionEdges(man.occlusion_edges ?? []);
    // Attach region_mask paths from this run when masks written
    for (const o of outputs) {
      if (!o.mask_path) continue;
      for (const e of edges) {
        if (e.region_mask && e.region_mask.includes(o.scenario.replace(/_/g, "_"))) {
          e.region_mask = o.mask_path.startsWith("masks/") ? o.mask_path : o.mask_path;
        }
      }
    }
    await writeOcclusionGraph(root, edges, { characterId: man.character_id });
  } catch {
    /* non-fatal */
  }

  const reportPath = path.join(root, "layers", "completions", "occlusion_report.json");
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        version: "0.3",
        method_field: "completion_method",
        methods: ["image_edit", "opencv_inpaint", "neighbor_blend"],
        scenarios: outputs,
        design_note:
          "Completion mask = occluder_dilated ∩ missing(occludee). Prefer minRegionInpaint (live image_edit → worker opencv/telea → neighbor_blend).",
      },
      null,
      2
    )
  );
  return { outputs, reportPath };
}
