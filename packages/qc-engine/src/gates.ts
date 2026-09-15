/**
 * Quality Gates 0–5 (DESIGN §10).
 * Gate 0 / 1 / 5: real heuristics (batch3). Gate 2 / 4 from batch2. Gate 3 via static-qc.
 */
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createStableId,
  type LayerManifest,
  type LayerNode,
  type ValidationFinding,
} from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";
import { loadLayerRgba } from "@ai2live/psd-compiler";
import { ANIME_UPPER_BODY_REQUIRED_SEMANTICS } from "./gate-semantics.js";

export type GateId =
  | "GATE_0_MASTER_BINDABILITY"
  | "GATE_1_LAYER_PLAN"
  | "GATE_2_VISIBLE_PIXEL_FIDELITY"
  | "GATE_3_COMPOSITE_FIDELITY"
  | "GATE_4_OVERLAP_SUFFICIENCY"
  | "GATE_5_GENERATED_REGION";

export interface GateResult {
  gate: GateId;
  passed: boolean;
  depth: "scaffold" | "heuristic" | "implemented";
  metrics: Record<string, number>;
  findings: ValidationFinding[];
  note?: string;
}

export interface QualityGatesReport {
  version: "0.1";
  gates: GateResult[];
  passed: boolean;
  findings: ValidationFinding[];
  metrics: Record<string, number>;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const BILATERAL = ["EYE", "ARM"];

/**
 * Gate 0: basic riggability on master —
 * aspect, alpha coverage, not tiny, front-ish silhouette heuristic.
 */
export async function runGate0MasterBindability(
  projectRoot: string,
  manifest: LayerManifest,
  masterPath?: string
): Promise<GateResult> {
  const findings: ValidationFinding[] = [];
  const metrics: Record<string, number> = {};
  const candidates = [
    masterPath,
    path.join(projectRoot, "design", "master_neutral.png"),
    path.join(projectRoot, "design", "master.png"),
  ].filter(Boolean) as string[];

  let master: string | undefined;
  for (const c of candidates) {
    if (await fileExists(c)) {
      master = c;
      break;
    }
  }

  if (!master) {
    findings.push({
      id: createStableId("finding", "g0-no-master"),
      severity: "WARNING",
      type: "GATE0_MISSING_MASTER",
      message: "No master image for Gate 0 bindability",
    });
    return {
      gate: "GATE_0_MASTER_BINDABILITY",
      passed: true,
      depth: "heuristic",
      metrics,
      findings,
      note: "Missing master skipped hard-fail",
    };
  }

  const { width, height } = manifest.canvas;
  metrics.canvas_width = width;
  metrics.canvas_height = height;
  metrics.canvas_aspect = width / Math.max(1, height);

  // Not tiny: reject absurdly small masters for rigging
  const meta = await sharp(master).metadata();
  const mw = meta.width ?? 0;
  const mh = meta.height ?? 0;
  metrics.master_native_width = mw;
  metrics.master_native_height = mh;
  metrics.master_min_side = Math.min(mw, mh);
  if (Math.min(mw, mh) < 64) {
    findings.push({
      id: createStableId("finding", "g0-tiny"),
      severity: "ERROR",
      type: "GATE0_MASTER_TOO_TINY",
      message: `Master min side ${Math.min(mw, mh)}px < 64 — too tiny to rig`,
      recommended_action: "Provide a higher-resolution master_neutral.png",
    });
  }

  // Aspect: upper-body anime typically portrait-ish (h >= w * 0.85) or square
  const aspect = width / Math.max(1, height);
  if (aspect > 1.6) {
    findings.push({
      id: createStableId("finding", "g0-aspect"),
      severity: "WARNING",
      type: "GATE0_UNUSUAL_ASPECT",
      message: `Canvas aspect ${aspect.toFixed(2)} is wide for upper-body anime template (heuristic)`,
    });
  }

  const raw = await sharp(master).ensureAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer();
  let opaque = 0;
  let edgeTouch = 0;
  let topHalf = 0;
  let bottomHalf = 0;
  let cxSum = 0;
  let cySum = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = raw[(y * width + x) * 4 + 3]!;
      if (a > 16) {
        opaque += 1;
        cxSum += x;
        cySum += y;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgeTouch += 1;
        if (y < height / 2) topHalf += 1;
        else bottomHalf += 1;
      }
    }
  }
  const coverage = opaque / (width * height);
  const edgeRatio = opaque ? edgeTouch / opaque : 0;
  const topBias = opaque ? topHalf / opaque : 0;
  const centroidX = opaque ? cxSum / opaque / width : 0.5;
  const centroidY = opaque ? cySum / opaque / height : 0.5;
  metrics.master_coverage = coverage;
  metrics.master_edge_touch_ratio = edgeRatio;
  metrics.master_top_half_bias = topBias;
  metrics.master_centroid_x = centroidX;
  metrics.master_centroid_y = centroidY;

  // Alpha coverage
  if (coverage < 0.05) {
    findings.push({
      id: createStableId("finding", "g0-empty"),
      severity: "ERROR",
      type: "GATE0_MASTER_EMPTY",
      message: `Master coverage ${coverage.toFixed(3)} too low for rigging`,
      recommended_action: "Regenerate / replace master_neutral.png",
    });
  } else if (coverage < 0.12) {
    findings.push({
      id: createStableId("finding", "g0-sparse"),
      severity: "WARNING",
      type: "GATE0_LOW_COVERAGE",
      message: `Master coverage ${coverage.toFixed(3)} is sparse for upper-body work`,
    });
  }

  if (edgeRatio > 0.35) {
    findings.push({
      id: createStableId("finding", "g0-crop"),
      severity: "WARNING",
      type: "GATE0_POSSIBLE_CROP",
      message: `High edge-touch ratio ${edgeRatio.toFixed(3)} — subject may be cropped`,
    });
  }

  // Front-ish heuristic: mass centered horizontally, head bias toward top half
  const frontish =
    centroidX > 0.28 &&
    centroidX < 0.72 &&
    centroidY < 0.72 &&
    topBias >= 0.35;
  metrics.master_frontish_score = frontish ? 1 : 0;
  if (!frontish && coverage >= 0.05) {
    findings.push({
      id: createStableId("finding", "g0-frontish"),
      severity: "WARNING",
      type: "GATE0_NOT_FRONTISH",
      message: `Front-ish silhouette heuristic failed (cx=${centroidX.toFixed(2)} cy=${centroidY.toFixed(2)} topBias=${topBias.toFixed(2)})`,
      recommended_action: "Prefer a front-facing upper-body master for auto layer plan",
    });
  }

  if (!findings.some((f) => f.severity === "ERROR" || f.severity === "WARNING")) {
    findings.push({
      id: createStableId("finding", "g0-ok"),
      severity: "INFO",
      type: "GATE0_OK",
      message: `Gate 0 OK coverage=${coverage.toFixed(3)} frontish=${frontish}`,
    });
  }

  return {
    gate: "GATE_0_MASTER_BINDABILITY",
    passed: !findings.some((f) => f.severity === "ERROR"),
    depth: "heuristic",
    metrics,
    findings,
    note: "Aspect / alpha coverage / min-size / front-ish centroid heuristics — not full VLM pose audit",
  };
}

/** Gate 1: layer plan completeness vs required semantics for upper-body anime template. */
export function runGate1LayerPlan(manifest: LayerManifest): GateResult {
  const findings: ValidationFinding[] = [];
  const metrics: Record<string, number> = {
    layer_count: manifest.layers.length,
    occlusion_edge_count: manifest.occlusion_edges?.length ?? 0,
  };

  const sems = new Set(manifest.layers.map((l) => l.semantic.toUpperCase()));
  const required = ANIME_UPPER_BODY_REQUIRED_SEMANTICS;
  const missing = required.filter((s) => ![...sems].some((x) => x.includes(s)));
  metrics.required_semantics = required.length;
  metrics.missing_required_semantics = missing.length;
  metrics.completeness_ratio = (required.length - missing.length) / required.length;

  if (missing.length) {
    const severity = missing.length >= 3 ? "ERROR" : "WARNING";
    findings.push({
      id: createStableId("finding", "g1-sem"),
      severity,
      type: "GATE1_MISSING_SEMANTICS",
      message: `Missing upper-body anime semantics: ${missing.join(", ")}`,
      recommended_action: "Re-run bootstrap / plan_layers for anime upper-body template",
    });
  }

  // Bilateral completeness for EYE/ARM
  for (const base of BILATERAL) {
    const sides = manifest.layers
      .filter((l) => l.semantic.toUpperCase().includes(base))
      .map((l) => l.side);
    if (sides.length === 0) {
      findings.push({
        id: createStableId("finding", `g1-missing-${base}`),
        severity: "WARNING",
        type: "GATE1_BILATERAL_MISSING",
        message: `No ${base} layers in plan`,
      });
      continue;
    }
    const hasL = sides.includes("LEFT");
    const hasR = sides.includes("RIGHT");
    if (!(hasL && hasR)) {
      findings.push({
        id: createStableId("finding", `g1-bilateral-${base}`),
        severity: "WARNING",
        type: "GATE1_BILATERAL_INCOMPLETE",
        message: `${base} layers missing LEFT/RIGHT pair (have: ${sides.join(",")})`,
      });
    }
  }

  // Occlusion edges recommended for hair↔face
  if ((manifest.occlusion_edges?.length ?? 0) === 0) {
    findings.push({
      id: createStableId("finding", "g1-occ"),
      severity: "INFO",
      type: "GATE1_NO_OCCLUSION_EDGES",
      message: "No occlusion_edges declared — completion scenarios will use semantic heuristics",
    });
  }

  // Asset path presence for planned layers
  const withoutAsset = manifest.layers.filter((l) => !l.source?.asset_path).length;
  metrics.layers_without_asset = withoutAsset;
  if (withoutAsset > 0) {
    findings.push({
      id: createStableId("finding", "g1-assets"),
      severity: "WARNING",
      type: "GATE1_MISSING_ASSETS",
      message: `${withoutAsset} layer(s) lack source.asset_path`,
    });
  }

  if (!findings.some((f) => f.severity === "WARNING" || f.severity === "ERROR")) {
    findings.push({
      id: createStableId("finding", "g1-ok"),
      severity: "INFO",
      type: "GATE1_OK",
      message: `Gate 1 layer plan completeness ${(metrics.completeness_ratio * 100).toFixed(0)}%`,
    });
  }

  return {
    gate: "GATE_1_LAYER_PLAN",
    passed: !findings.some((f) => f.severity === "ERROR"),
    depth: "heuristic",
    metrics,
    findings,
    note: "Completeness vs anime upper-body template semantics + bilateral + asset paths",
  };
}

/**
 * Gate 2: visible pixel reuse ratio in layer ROI vs master.
 */
export async function runGate2VisiblePixelFidelity(
  projectRoot: string,
  manifest: LayerManifest,
  masterPath: string | undefined,
  opts?: { matchThreshold?: number; minRatio?: number }
): Promise<GateResult> {
  const matchThreshold = opts?.matchThreshold ?? 24;
  const minRatio = opts?.minRatio ?? 0.95;
  const findings: ValidationFinding[] = [];
  const metrics: Record<string, number> = {};

  if (!masterPath || !(await fileExists(masterPath))) {
    findings.push({
      id: createStableId("finding", "g2-no-master"),
      severity: "WARNING",
      type: "GATE2_SKIPPED",
      message: "No master for Gate 2 visible pixel fidelity",
    });
    return {
      gate: "GATE_2_VISIBLE_PIXEL_FIDELITY",
      passed: true,
      depth: "implemented",
      metrics,
      findings,
    };
  }

  const { width, height } = manifest.canvas;
  const master = await sharp(masterPath)
    .ensureAlpha()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();

  let totalMasterVis = 0;
  let totalMatch = 0;
  const perLayer: Array<{ id: string; ratio: number; samples: number }> = [];

  for (const layer of manifest.layers) {
    if (!layer.source.asset_path || !layer.canvas_bounds) continue;
    if (
      layer.source.type === "full_character_differential" ||
      layer.source.type === "generated_standalone"
    ) {
      continue;
    }
    let loaded: Awaited<ReturnType<typeof loadLayerRgba>>;
    try {
      loaded = await loadLayerRgba(projectRoot, manifest, layer);
    } catch {
      continue;
    }
    const b = layer.canvas_bounds;
    const x0 = Math.round(b.x * width);
    const y0 = Math.round(b.y * height);
    const x1 = Math.round((b.x + b.w) * width);
    const y1 = Math.round((b.y + b.h) * height);
    let samples = 0;
    let matches = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 4;
        if (master[i + 3]! < 16) continue;
        if (loaded.rgba[i + 3]! < 16) continue;
        samples += 1;
        const dr = Math.abs(master[i]! - loaded.rgba[i]!);
        const dg = Math.abs(master[i + 1]! - loaded.rgba[i + 1]!);
        const db = Math.abs(master[i + 2]! - loaded.rgba[i + 2]!);
        if (dr + dg + db <= matchThreshold * 3) matches += 1;
      }
    }
    if (samples > 0) {
      const ratio = matches / samples;
      perLayer.push({ id: layer.id, ratio, samples });
      totalMasterVis += samples;
      totalMatch += matches;
      if (ratio < minRatio) {
        const severity = ratio < Math.min(0.5, minRatio) ? "ERROR" : "WARNING";
        findings.push({
          id: createStableId("finding", `g2-${layer.id}`),
          severity,
          type: "GATE2_VISIBLE_PIXEL_LOW",
          related_layers: [layer.id],
          message: `Layer ${layer.semantic} visible_pixel_reuse_ratio=${ratio.toFixed(3)} < ${minRatio}`,
          recommended_action: "Prefer see-through master pixels for visible ROI",
        });
      }
    }
  }

  const overall = totalMasterVis ? totalMatch / totalMasterVis : 1;
  metrics.visible_pixel_reuse_ratio = overall;
  metrics.gate2_layers_checked = perLayer.length;
  metrics.gate2_samples = totalMasterVis;

  if (perLayer.length === 0) {
    findings.push({
      id: createStableId("finding", "g2-none"),
      severity: "WARNING",
      type: "GATE2_NO_LAYERS",
      message: "No layers with bounds+assets for Gate 2",
    });
  } else if (!findings.some((f) => f.severity === "ERROR")) {
    findings.push({
      id: createStableId("finding", "g2-ok"),
      severity: "INFO",
      type: "GATE2_OK",
      message: `Gate 2 OK overall visible_pixel_reuse_ratio=${overall.toFixed(3)}`,
    });
  }

  return {
    gate: "GATE_2_VISIBLE_PIXEL_FIDELITY",
    passed: !findings.some((f) => f.severity === "ERROR"),
    depth: "implemented",
    metrics,
    findings,
    note: "Compares layer RGBA vs master in ROI where both opaque; threshold heuristic",
  };
}

function defaultOverlapPx(occludee: LayerNode, occluder: LayerNode, masterRes: number): number {
  const scale = masterRes / 2048;
  const pair = `${occluder.semantic}|${occludee.semantic}`.toUpperCase();
  let base = 16;
  if (pair.includes("FACE") && pair.includes("HAIR")) base = 20;
  else if (pair.includes("ARM") || pair.includes("BODY")) base = 24;
  else if (pair.includes("NECK")) base = 24;
  return Math.max(4, Math.round(base * scale));
}

export async function runGate4OverlapSufficiency(
  projectRoot: string,
  manifest: LayerManifest
): Promise<GateResult> {
  const findings: ValidationFinding[] = [];
  const metrics: Record<string, number> = {};
  const { width, height } = manifest.canvas;
  const masterRes = Math.max(width, height);

  const byId = new Map(manifest.layers.map((l) => [l.id, l]));
  const pairs: Array<{ a: LayerNode; b: LayerNode; minPx: number }> = [];

  for (const layer of manifest.layers) {
    if (layer.overlap?.required_with?.length) {
      for (const otherId of layer.overlap.required_with) {
        const other = byId.get(otherId);
        if (!other) continue;
        const minPx =
          layer.overlap.minimum_px_at_master_resolution ??
          defaultOverlapPx(layer, other, masterRes);
        pairs.push({ a: layer, b: other, minPx });
      }
    }
  }

  if (pairs.length === 0) {
    const face = manifest.layers.find((l) => l.semantic.toUpperCase().includes("FACE"));
    const hair = manifest.layers.find((l) => l.semantic.toUpperCase().includes("FRONT_HAIR"));
    const body = manifest.layers.find((l) => l.semantic.toUpperCase().includes("BODY"));
    const arm = manifest.layers.find((l) => l.semantic.toUpperCase().includes("ARM"));
    if (face && hair) pairs.push({ a: face, b: hair, minPx: defaultOverlapPx(face, hair, masterRes) });
    if (body && arm) pairs.push({ a: arm, b: body, minPx: defaultOverlapPx(arm, body, masterRes) });
  }

  let checked = 0;
  let failed = 0;
  for (const { a, b, minPx } of pairs) {
    if (!a.source.asset_path || !b.source.asset_path) continue;
    let La: Awaited<ReturnType<typeof loadLayerRgba>>;
    let Lb: Awaited<ReturnType<typeof loadLayerRgba>>;
    try {
      La = await loadLayerRgba(projectRoot, manifest, a);
      Lb = await loadLayerRgba(projectRoot, manifest, b);
    } catch {
      continue;
    }
    let overlapPx = 0;
    for (let i = 0; i < La.rgba.length; i += 4) {
      if (La.rgba[i + 3]! > 32 && Lb.rgba[i + 3]! > 32) overlapPx += 1;
    }
    checked += 1;
    metrics[`overlap_${a.semantic}_${b.semantic}`] = overlapPx;
    if (overlapPx < minPx) {
      failed += 1;
      const severity = overlapPx === 0 ? "ERROR" : "WARNING";
      findings.push({
        id: createStableId("finding", `g4-${a.id}-${b.id}`),
        severity,
        type: "GATE4_OVERLAP_INSUFFICIENT",
        related_layers: [a.id, b.id],
        message: `Overlap ${a.semantic}∩${b.semantic}=${overlapPx}px < min ${minPx}px (heuristic)`,
        recommended_action: "Expand hidden margin / completion under occluder",
      });
    }
  }

  metrics.gate4_pairs_checked = checked;
  metrics.gate4_pairs_failed = failed;

  if (checked === 0) {
    findings.push({
      id: createStableId("finding", "g4-skip"),
      severity: "WARNING",
      type: "GATE4_SKIPPED",
      message: "No overlap pairs could be evaluated",
    });
  } else if (failed === 0) {
    findings.push({
      id: createStableId("finding", "g4-ok"),
      severity: "INFO",
      type: "GATE4_OK",
      message: `Gate 4 OK for ${checked} pair(s)`,
    });
  }

  return {
    gate: "GATE_4_OVERLAP_SUFFICIENCY",
    passed: !findings.some((f) => f.severity === "ERROR"),
    depth: "heuristic",
    metrics,
    findings,
    note: "Alpha-overlap pixel count vs DESIGN-inspired min margins (scaled). Not motion-amplitude aware.",
  };
}

/**
 * Gate 5: generated-region consistency —
 * compare completion ROI stats vs neighbor ring (color distance / edge)
 * when completion_method != master_pixels.
 */
export async function runGate5GeneratedRegion(
  projectRoot: string,
  manifest: LayerManifest
): Promise<GateResult> {
  const findings: ValidationFinding[] = [];
  const metrics: Record<string, number> = {};
  const root = path.resolve(projectRoot);
  const { width, height } = manifest.canvas;

  // Prefer occlusion completion report when present
  const reportPath = path.join(root, "layers", "completions", "occlusion_report.json");
  let scenarios: Array<{
    path: string;
    mask_path?: string;
    completion_method?: string;
    scenario?: string;
  }> = [];
  if (await fileExists(reportPath)) {
    try {
      const rep = JSON.parse(await readFile(reportPath, "utf8")) as {
        scenarios?: typeof scenarios;
      };
      scenarios = rep.scenarios ?? [];
    } catch {
      scenarios = [];
    }
  }

  const generatedLayers = manifest.layers.filter(
    (l) =>
      l.source.type === "master_plus_completion" ||
      l.source.type === "generated_standalone" ||
      l.source.type === "full_character_differential"
  );
  metrics.generated_layer_count = generatedLayers.length;
  metrics.completion_scenario_count = scenarios.length;

  let checked = 0;
  let warnCount = 0;
  let sumColorDist = 0;
  let sumEdgeDiff = 0;

  const evaluateRoi = async (
    imageAbs: string,
    maskAbs: string | undefined,
    label: string
  ): Promise<void> => {
    if (!(await fileExists(imageAbs))) return;
    const rgba = await sharp(imageAbs)
      .ensureAlpha()
      .resize(width, height, { fit: "fill" })
      .raw()
      .toBuffer();
    let mask: Buffer;
    if (maskAbs && (await fileExists(maskAbs))) {
      mask = await sharp(maskAbs)
        .ensureAlpha()
        .resize(width, height, { fit: "fill" })
        .raw()
        .toBuffer();
    } else {
      // Treat semi-transparent newly filled as ROI if no mask
      mask = Buffer.alloc(width * height * 4, 0);
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3]! > 16 && rgba[i + 3]! < 240) {
          mask[i] = mask[i + 1] = mask[i + 2] = mask[i + 3] = 255;
        }
      }
    }

    let roiN = 0;
    let neighN = 0;
    let roiR = 0,
      roiG = 0,
      roiB = 0;
    let nR = 0,
      nG = 0,
      nB = 0;
    let edgeRoi = 0;
    let edgeNeigh = 0;

    const isRoi = (x: number, y: number) => mask[(y * width + x) * 4 + 3]! >= 128;
    const lum = (i: number) => 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3]! < 16) continue;
        const gx = Math.abs(lum(i + 4) - lum(i - 4));
        const gy = Math.abs(lum(i + width * 4) - lum(i - width * 4));
        const grad = gx + gy;
        if (isRoi(x, y)) {
          roiN++;
          roiR += rgba[i]!;
          roiG += rgba[i + 1]!;
          roiB += rgba[i + 2]!;
          edgeRoi += grad;
        } else {
          // Neighbor ring: within 3px of ROI
          let near = false;
          for (let dy = -3; dy <= 3 && !near; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              if (isRoi(nx, ny)) near = true;
            }
          }
          if (near) {
            neighN++;
            nR += rgba[i]!;
            nG += rgba[i + 1]!;
            nB += rgba[i + 2]!;
            edgeNeigh += grad;
          }
        }
      }
    }

    if (roiN < 8 || neighN < 8) return;
    checked += 1;
    const colorDist =
      Math.abs(roiR / roiN - nR / neighN) +
      Math.abs(roiG / roiN - nG / neighN) +
      Math.abs(roiB / roiN - nB / neighN);
    const edgeDiff = Math.abs(edgeRoi / roiN - edgeNeigh / neighN);
    sumColorDist += colorDist;
    sumEdgeDiff += edgeDiff;
    metrics[`g5_color_dist_${label}`] = colorDist;
    metrics[`g5_edge_diff_${label}`] = edgeDiff;

    // Thresholds: mean channel L1 > 90 or edge mean diff > 40 → warn
    if (colorDist > 90 || edgeDiff > 40) {
      warnCount += 1;
      findings.push({
        id: createStableId("finding", `g5-${label}`),
        severity: colorDist > 140 ? "WARNING" : "INFO",
        type: "GATE5_REGION_INCONSISTENT",
        message: `Generated region ${label}: color_dist=${colorDist.toFixed(1)} edge_diff=${edgeDiff.toFixed(1)} vs neighbor ring`,
        recommended_action: "Re-run occlusion inpaint or expand feather",
      });
    }
  };

  for (const s of scenarios) {
    const method = (s.completion_method ?? "").toLowerCase();
    if (method === "master_pixels") continue;
    await evaluateRoi(
      path.join(root, s.path),
      s.mask_path ? path.join(root, s.mask_path) : undefined,
      s.scenario ?? path.basename(s.path, ".png")
    );
  }

  // Also check generated_standalone / completion layers when no scenarios
  if (scenarios.length === 0) {
    for (const layer of generatedLayers) {
      if (!layer.source.asset_path) continue;
      if (layer.source.type === "master_pixels") continue;
      await evaluateRoi(path.join(root, layer.source.asset_path), undefined, layer.semantic);
    }
  }

  metrics.gate5_rois_checked = checked;
  metrics.gate5_warn_count = warnCount;
  metrics.gate5_mean_color_dist = checked ? sumColorDist / checked : 0;
  metrics.gate5_mean_edge_diff = checked ? sumEdgeDiff / checked : 0;

  if (checked === 0) {
    findings.push({
      id: createStableId("finding", "g5-none"),
      severity: "INFO",
      type: "GATE5_NO_GENERATED_ROI",
      message:
        "No completion ROIs to score (run occlusion first, or no non-master_pixels generations)",
    });
  } else if (warnCount === 0) {
    findings.push({
      id: createStableId("finding", "g5-ok"),
      severity: "INFO",
      type: "GATE5_OK",
      message: `Gate 5 OK for ${checked} ROI(s); mean color_dist=${metrics.gate5_mean_color_dist.toFixed(1)}`,
    });
  }

  return {
    gate: "GATE_5_GENERATED_REGION",
    passed: !findings.some((f) => f.severity === "ERROR"),
    depth: "heuristic",
    metrics,
    findings,
    note: "Compares completion ROI mean RGB + edge energy vs neighbor ring when completion_method != master_pixels",
  };
}

/** @deprecated alias */
export function runGate5GeneratedRegionScaffold(manifest: LayerManifest): GateResult {
  return {
    gate: "GATE_5_GENERATED_REGION",
    passed: true,
    depth: "scaffold",
    metrics: {
      generated_layer_count: manifest.layers.filter(
        (l) =>
          l.source.type === "master_plus_completion" ||
          l.source.type === "generated_standalone" ||
          l.source.type === "full_character_differential"
      ).length,
    },
    findings: [
      {
        id: createStableId("finding", "g5-deprecated"),
        severity: "INFO",
        type: "GATE5_USE_ASYNC",
        message: "Use runGate5GeneratedRegion (async) — scaffold alias retained",
      },
    ],
  };
}

export async function runQualityGates(opts: {
  projectRoot: string;
  manifest?: LayerManifest;
  masterPath?: string;
  gate3?: { mae?: number; mse?: number; passed?: boolean; findings?: ValidationFinding[] };
}): Promise<QualityGatesReport> {
  const root = path.resolve(opts.projectRoot);
  const manifest =
    opts.manifest ??
    (assertLayerManifest(
      JSON.parse(await readFile(path.join(root, "spec", "layer_manifest.json"), "utf8"))
    ) as LayerManifest);

  let masterPath = opts.masterPath;
  if (!masterPath) {
    for (const c of [
      path.join(root, "design", "master_neutral.png"),
      path.join(root, "design", "master.png"),
    ]) {
      if (await fileExists(c)) {
        masterPath = c;
        break;
      }
    }
  }

  const g0 = await runGate0MasterBindability(root, manifest, masterPath);
  const g1 = runGate1LayerPlan(manifest);
  const g2 = await runGate2VisiblePixelFidelity(root, manifest, masterPath);
  const g4 = await runGate4OverlapSufficiency(root, manifest);
  const g5 = await runGate5GeneratedRegion(root, manifest);

  const g3Findings = opts.gate3?.findings ?? [];
  const g3: GateResult = {
    gate: "GATE_3_COMPOSITE_FIDELITY",
    passed: opts.gate3?.passed ?? true,
    depth: "implemented",
    metrics: {
      ...(opts.gate3?.mae !== undefined ? { mae: opts.gate3.mae } : {}),
      ...(opts.gate3?.mse !== undefined ? { mse: opts.gate3.mse } : {}),
    },
    findings:
      g3Findings.length > 0
        ? g3Findings
        : [
            {
              id: createStableId("finding", "g3-deferred"),
              severity: "INFO",
              type: "GATE3_FROM_STATIC_QC",
              message: "Gate 3 metrics come from static composite QC",
            },
          ],
    note: "Tightened MAE/MSE thresholds applied in runStaticQc",
  };

  const gates = [g0, g1, g2, g3, g4, g5];
  const findings = gates.flatMap((g) => g.findings);
  const metrics: Record<string, number> = {};
  for (const g of gates) Object.assign(metrics, g.metrics);
  const passed = gates.every((g) => g.passed);

  return { version: "0.1", gates, passed, findings, metrics };
}
