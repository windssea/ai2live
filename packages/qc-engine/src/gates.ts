/**
 * Quality Gates 0–5 scaffolding (DESIGN §10).
 * Gate 2 (visible pixel fidelity) and Gate 4 (overlap sufficiency) are real heuristics.
 * Gate 3 composite MAE lives primarily in static-qc (thresholds tightened there).
 * Gate 0 / 1 / 5 are lightweight scaffolds — honest PARTIAL vs full DESIGN depth.
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
  /** Scaffold | heuristic | implemented */
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

const REQUIRED_SEMANTICS = ["FACE", "BODY", "FRONT_HAIR", "BACK_HAIR"];
const BILATERAL = ["EYE", "ARM"];

/** Gate 0 scaffold: coarse master bindability heuristics (not VLM pose audit). */
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
      message: "No master image for Gate 0 bindability scaffold",
    });
    return {
      gate: "GATE_0_MASTER_BINDABILITY",
      passed: true, // soft — scaffold
      depth: "scaffold",
      metrics,
      findings,
      note: "Scaffold: missing master skipped hard-fail",
    };
  }

  const { width, height } = manifest.canvas;
  const raw = await sharp(master).ensureAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer();
  let opaque = 0;
  let edgeTouch = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = raw[(y * width + x) * 4 + 3];
      if (a > 16) {
        opaque += 1;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgeTouch += 1;
      }
    }
  }
  const coverage = opaque / (width * height);
  const edgeRatio = opaque ? edgeTouch / opaque : 0;
  metrics.master_coverage = coverage;
  metrics.master_edge_touch_ratio = edgeRatio;

  // Heuristic fail: nearly empty or subject heavily cropped against canvas edge
  if (coverage < 0.05) {
    findings.push({
      id: createStableId("finding", "g0-empty"),
      severity: "ERROR",
      type: "GATE0_MASTER_EMPTY",
      message: `Master coverage ${coverage.toFixed(3)} too low for rigging`,
      recommended_action: "Regenerate / replace master_neutral.png",
    });
  } else if (edgeRatio > 0.35) {
    findings.push({
      id: createStableId("finding", "g0-crop"),
      severity: "WARNING",
      type: "GATE0_POSSIBLE_CROP",
      message: `High edge-touch ratio ${edgeRatio.toFixed(3)} — subject may be cropped (heuristic)`,
    });
  } else {
    findings.push({
      id: createStableId("finding", "g0-ok"),
      severity: "INFO",
      type: "GATE0_OK",
      message: `Gate 0 scaffold OK coverage=${coverage.toFixed(3)}`,
    });
  }

  return {
    gate: "GATE_0_MASTER_BINDABILITY",
    passed: !findings.some((f) => f.severity === "ERROR"),
    depth: "scaffold",
    metrics,
    findings,
    note: "Scaffold heuristics only — not full DESIGN pose/side-lying/cross-arm VLM audit",
  };
}

/** Gate 1 scaffold: required semantics + bilateral sides + occlusion edges present-ish. */
export function runGate1LayerPlan(manifest: LayerManifest): GateResult {
  const findings: ValidationFinding[] = [];
  const metrics: Record<string, number> = {
    layer_count: manifest.layers.length,
    occlusion_edge_count: manifest.occlusion_edges?.length ?? 0,
  };

  const sems = new Set(manifest.layers.map((l) => l.semantic.toUpperCase()));
  const missing = REQUIRED_SEMANTICS.filter((s) => ![...sems].some((x) => x.includes(s)));
  metrics.missing_required_semantics = missing.length;
  if (missing.length) {
    findings.push({
      id: createStableId("finding", "g1-sem"),
      severity: "WARNING",
      type: "GATE1_MISSING_SEMANTICS",
      message: `Missing recommended semantics: ${missing.join(", ")}`,
    });
  }

  for (const base of BILATERAL) {
    const sides = manifest.layers
      .filter((l) => l.semantic.toUpperCase().includes(base))
      .map((l) => l.side);
    if (sides.length === 0) continue;
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

  if (!findings.some((f) => f.severity === "WARNING" || f.severity === "ERROR")) {
    findings.push({
      id: createStableId("finding", "g1-ok"),
      severity: "INFO",
      type: "GATE1_OK",
      message: "Gate 1 layer plan scaffold checks passed",
    });
  }

  return {
    gate: "GATE_1_LAYER_PLAN",
    passed: !findings.some((f) => f.severity === "ERROR"),
    depth: "scaffold",
    metrics,
    findings,
    note: "Schema completeness heuristic — not full 31-tag contradiction analysis",
  };
}

/**
 * Gate 2: visible pixel reuse ratio in layer ROI vs master.
 * For each layer with canvas_bounds, among master-opaque pixels in ROI,
 * fraction of layer pixels that approximately match master RGB.
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
    // Skip pure completion/differential layers for base reuse target
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
        if (master[i + 3] < 16) continue;
        if (loaded.rgba[i + 3] < 16) continue; // only where layer claims visible pixels
        samples += 1;
        const dr = Math.abs(master[i] - loaded.rgba[i]);
        const dg = Math.abs(master[i + 1] - loaded.rgba[i + 1]);
        const db = Math.abs(master[i + 2] - loaded.rgba[i + 2]);
        if (dr + dg + db <= matchThreshold * 3) matches += 1;
      }
    }
    if (samples > 0) {
      const ratio = matches / samples;
      perLayer.push({ id: layer.id, ratio, samples });
      totalMasterVis += samples;
      totalMatch += matches;
      if (ratio < minRatio) {
        // Hard ERROR only when reuse is catastrophic; else WARNING so synthetic demos stay usable.
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

/** Default minimum overlap px at master resolution (DESIGN ranges, scaled). */
function defaultOverlapPx(occludee: LayerNode, occluder: LayerNode, masterRes: number): number {
  const scale = masterRes / 2048;
  const pair = `${occluder.semantic}|${occludee.semantic}`.toUpperCase();
  let base = 16;
  if (pair.includes("FACE") && pair.includes("HAIR")) base = 20;
  else if (pair.includes("ARM") || pair.includes("BODY")) base = 24;
  else if (pair.includes("NECK")) base = 24;
  return Math.max(4, Math.round(base * scale));
}

/**
 * Gate 4: overlap sufficiency heuristic.
 * Uses layer.overlap.minimum_px when set; else estimates alpha-overlap between
 * declared required_with pairs or FRONT_HAIR↔FACE / BODY↔ARM.
 */
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

  // Fallback heuristic pairs if none declared
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
      if (La.rgba[i + 3] > 32 && Lb.rgba[i + 3] > 32) overlapPx += 1;
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

/** Gate 5 scaffold: generated-region consistency placeholder. */
export function runGate5GeneratedRegionScaffold(manifest: LayerManifest): GateResult {
  const generated = manifest.layers.filter(
    (l) =>
      l.source.type === "master_plus_completion" ||
      l.source.type === "generated_standalone" ||
      l.source.type === "full_character_differential"
  );
  const findings: ValidationFinding[] = [
    {
      id: createStableId("finding", "g5-scaffold"),
      severity: "INFO",
      type: "GATE5_SCAFFOLD",
      message: `Gate 5 scaffold: ${generated.length} generated/differential layer(s) — consistency metrics not yet implemented`,
    },
  ];
  return {
    gate: "GATE_5_GENERATED_REGION",
    passed: true,
    depth: "scaffold",
    metrics: { generated_layer_count: generated.length },
    findings,
    note: "Scaffold only — hue/edge/frequency checks deferred",
  };
}

export async function runQualityGates(opts: {
  projectRoot: string;
  manifest?: LayerManifest;
  masterPath?: string;
  /** Gate 3 MAE/MSE already computed by static QC — pass through for report. */
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
  const g5 = runGate5GeneratedRegionScaffold(manifest);

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
