/**
 * DESIGN §7.13 / DoD #11 — map vision/QC failures → layer_id + problem_type.
 */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import type { DualJudgeResult, VlmVerdict } from "./types.js";
import type { VlmReviewIssue } from "./schema.js";

/** DESIGN §7.13 defect types. */
export const PROBLEM_TYPES = [
  "HOLE",
  "SEAM",
  "WRONG_Z",
  "STYLE_DRIFT",
  "POSITION_DRIFT",
  "EDGE_DIRT",
  "HAIR_ROOT_DETACH",
  "NECK_GAP",
  "EYE_ESCAPE",
  "MOUTH_DRIFT",
  "OVERLAP_EXCESS",
  "PHYSICS_TEAR",
  "OTHER",
] as const;

export type ProblemType = (typeof PROBLEM_TYPES)[number];

export interface LocalizedFailure {
  finding_id?: string;
  layer_id: string | null;
  layer_semantic?: string;
  problem_type: ProblemType;
  severity: "ERROR" | "WARNING" | "INFO";
  message: string;
  source: "cv" | "vlm" | "gate" | "metric";
  recommended_action?: string;
}

export interface FailureLocalizationReport {
  version: "0.1";
  timestamp: string;
  passed: boolean;
  findings: LocalizedFailure[];
  policy: string;
}

const VLM_CODE_TO_PROBLEM: Record<string, ProblemType> = {
  hair_unnatural: "HAIR_ROOT_DETACH",
  occlusion_gap: "HOLE",
  face_crack: "SEAM",
  eye_drift: "EYE_ESCAPE",
  mouth_misalign: "MOUTH_DRIFT",
  layer_bleed: "OVERLAP_EXCESS",
  identity_drift: "STYLE_DRIFT",
  other: "OTHER",
};

const FINDING_TYPE_TO_PROBLEM: Record<string, ProblemType> = {
  COMPOSITE_MAE_HIGH: "STYLE_DRIFT",
  COMPOSITE_FIDELITY: "SEAM",
  ALPHA_MISMATCH: "HOLE",
  EDGE_MISMATCH: "EDGE_DIRT",
  GATE2_LOW_REUSE: "STYLE_DRIFT",
  GATE4_OVERLAP: "HOLE",
  GATE4_INSUFFICIENT_OVERLAP: "HOLE",
  GATE5_GENERATED: "STYLE_DRIFT",
  GATE0_NOT_FRONTISH: "POSITION_DRIFT",
  GATE0_POSSIBLE_CROP: "POSITION_DRIFT",
  GATE0_LR_IMBALANCE: "POSITION_DRIFT",
  GATE0_COLOR_REGIONS: "STYLE_DRIFT",
  GATE7_POSE: "PHYSICS_TEAR",
  DUAL_JUDGE_NOT_VALIDATED: "OTHER",
  HAIR: "HAIR_ROOT_DETACH",
  NECK: "NECK_GAP",
  EYE: "EYE_ESCAPE",
  MOUTH: "MOUTH_DRIFT",
  Z_ORDER: "WRONG_Z",
  SEAM: "SEAM",
  HOLE: "HOLE",
};

interface LayerRef {
  id: string;
  semantic: string;
  side?: string;
  display_name?: string;
}

function pickLayer(
  layers: LayerRef[],
  prefer: RegExp[],
  side?: "LEFT" | "RIGHT" | "CENTER"
): LayerRef | null {
  for (const re of prefer) {
    const hits = layers.filter((l) => re.test(l.semantic) || re.test(l.display_name ?? ""));
    if (!hits.length) continue;
    if (side) {
      const sided = hits.find((h) => (h.side ?? "").toUpperCase() === side);
      if (sided) return sided;
    }
    return hits[0]!;
  }
  return layers[0] ?? null;
}

function problemFromFindingType(type: string): ProblemType {
  const t = type.toUpperCase();
  for (const [k, v] of Object.entries(FINDING_TYPE_TO_PROBLEM)) {
    if (t.includes(k)) return v;
  }
  if (t.includes("HAIR")) return "HAIR_ROOT_DETACH";
  if (t.includes("EYE")) return "EYE_ESCAPE";
  if (t.includes("MOUTH")) return "MOUTH_DRIFT";
  if (t.includes("NECK")) return "NECK_GAP";
  if (t.includes("OVERLAP") || t.includes("OCCLUSION")) return "HOLE";
  if (t.includes("SEAM") || t.includes("EDGE")) return "EDGE_DIRT";
  if (t.includes("Z_") || t.includes("ZORDER")) return "WRONG_Z";
  return "OTHER";
}

function layerForProblem(problem: ProblemType, layers: LayerRef[]): LayerRef | null {
  switch (problem) {
    case "HAIR_ROOT_DETACH":
      return pickLayer(layers, [/FRONT_HAIR|BANG/i, /BACK_HAIR|HAIR/i]);
    case "NECK_GAP":
      return pickLayer(layers, [/NECK/i, /FACE/i, /BODY/i]);
    case "EYE_ESCAPE":
      return pickLayer(layers, [/EYE|IRIS/i]);
    case "MOUTH_DRIFT":
      return pickLayer(layers, [/MOUTH/i, /FACE/i]);
    case "HOLE":
    case "SEAM":
      return pickLayer(layers, [/FACE/i, /FRONT_HAIR/i, /BODY/i]);
    case "OVERLAP_EXCESS":
    case "EDGE_DIRT":
      return pickLayer(layers, [/FRONT_HAIR/i, /FACE/i]);
    case "WRONG_Z":
      return pickLayer(layers, [/FRONT_HAIR/i, /FACE/i]);
    case "PHYSICS_TEAR":
      return pickLayer(layers, [/HAIR/i, /ARM/i]);
    case "STYLE_DRIFT":
    case "POSITION_DRIFT":
      return pickLayer(layers, [/FACE/i, /BODY/i]);
    default:
      return pickLayer(layers, [/FACE/i, /BODY/i, /./]);
  }
}

function actionFor(problem: ProblemType): string {
  const map: Record<ProblemType, string> = {
    HOLE: "Back-layer completion / expand overlap",
    SEAM: "Feather/blend or regenerate hidden completion",
    STYLE_DRIFT: "Preserve visible pixels; replace generated region only",
    POSITION_DRIFT: "Spatial registration correction",
    WRONG_Z: "Manifest z-order correction",
    EYE_ESCAPE: "Mask / rig hint correction for eye",
    MOUTH_DRIFT: "Bounds / pivot correction for mouth",
    EDGE_DIRT: "Clean edge / refine mask feather",
    HAIR_ROOT_DETACH: "Repair hair root attachment / bangs completion",
    NECK_GAP: "Neck under chin completion",
    OVERLAP_EXCESS: "Reduce overlap or fix bleed mask",
    PHYSICS_TEAR: "Adjust physics / mesh attachment",
    OTHER: "Inspect dual_judge.json and related layers",
  };
  return map[problem];
}

async function loadLayers(projectRoot: string): Promise<LayerRef[]> {
  const manifestPath = path.join(projectRoot, "spec", "layer_manifest.json");
  try {
    await access(manifestPath);
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
      layers?: LayerRef[];
    };
    return (raw.layers ?? []).map((l) => ({
      id: l.id,
      semantic: l.semantic,
      side: l.side,
      display_name: l.display_name,
    }));
  } catch {
    return [];
  }
}

/** Attribute VLM issues + CV findings + metric heuristics → localized failures. */
export function localizeFailures(opts: {
  layers: LayerRef[];
  cvFindings?: Array<{
    id?: string;
    severity?: string;
    type?: string;
    message?: string;
    related_layers?: string[];
    recommended_action?: string;
  }>;
  vlm?: VlmVerdict | null;
  metrics?: Record<string, number>;
}): LocalizedFailure[] {
  const out: LocalizedFailure[] = [];
  const layers = opts.layers;

  for (const f of opts.cvFindings ?? []) {
    const sev = String(f.severity ?? "WARNING").toUpperCase();
    if (sev === "INFO") continue;
    const problem = problemFromFindingType(String(f.type ?? "OTHER"));
    let layer: LayerRef | null = null;
    if (f.related_layers?.length) {
      layer = layers.find((l) => f.related_layers!.includes(l.id)) ?? {
        id: f.related_layers[0]!,
        semantic: "UNKNOWN",
      };
    } else {
      layer = layerForProblem(problem, layers);
    }
    out.push({
      finding_id: f.id,
      layer_id: layer?.id ?? null,
      layer_semantic: layer?.semantic,
      problem_type: problem,
      severity: sev === "ERROR" ? "ERROR" : "WARNING",
      message: f.message ?? String(f.type ?? problem),
      source: String(f.type ?? "").startsWith("GATE") ? "gate" : "cv",
      recommended_action: f.recommended_action ?? actionFor(problem),
    });
  }

  const structuredIssues: VlmReviewIssue[] = opts.vlm?.structured?.issues ?? [];
  if (structuredIssues.length) {
    for (const issue of structuredIssues) {
      const problem = VLM_CODE_TO_PROBLEM[issue.code] ?? "OTHER";
      const layer = layerForProblem(problem, layers);
      out.push({
        layer_id: layer?.id ?? null,
        layer_semantic: layer?.semantic,
        problem_type: problem,
        severity: issue.severity,
        message: issue.message,
        source: "vlm",
        recommended_action: actionFor(problem),
      });
    }
  } else if (opts.vlm && !opts.vlm.passed) {
    for (const issue of opts.vlm.issues ?? []) {
      const code = String(issue).toLowerCase();
      let problem: ProblemType = "OTHER";
      for (const [k, v] of Object.entries(VLM_CODE_TO_PROBLEM)) {
        if (code.includes(k)) {
          problem = v;
          break;
        }
      }
      const layer = layerForProblem(problem, layers);
      out.push({
        layer_id: layer?.id ?? null,
        layer_semantic: layer?.semantic,
        problem_type: problem,
        severity: "ERROR",
        message: String(issue),
        source: "vlm",
        recommended_action: actionFor(problem),
      });
    }
  }

  // Metric heuristics (dry-run friendly): attribute likely layers when scores/metrics look weak
  const m = opts.metrics ?? {};
  const metricHints: Array<{ key: string; thresh: number; lt: boolean; problem: ProblemType }> = [
    { key: "mae", thresh: 25, lt: false, problem: "STYLE_DRIFT" },
    { key: "visible_pixel_reuse_ratio", thresh: 0.85, lt: true, problem: "STYLE_DRIFT" },
    { key: "overlap_min_px", thresh: 8, lt: true, problem: "HOLE" },
    { key: "hair_naturalness", thresh: 0.55, lt: true, problem: "HAIR_ROOT_DETACH" },
    { key: "occlusion_integrity", thresh: 0.55, lt: true, problem: "HOLE" },
    { key: "face_continuity", thresh: 0.55, lt: true, problem: "SEAM" },
    { key: "eye_alignment", thresh: 0.55, lt: true, problem: "EYE_ESCAPE" },
  ];
  for (const h of metricHints) {
    const v = m[h.key];
    if (typeof v !== "number") continue;
    const bad = h.lt ? v < h.thresh : v > h.thresh;
    if (!bad) continue;
    // Avoid duplicate if we already have same problem from CV/VLM
    if (out.some((o) => o.problem_type === h.problem && o.source !== "metric")) continue;
    const layer = layerForProblem(h.problem, layers);
    out.push({
      layer_id: layer?.id ?? null,
      layer_semantic: layer?.semantic,
      problem_type: h.problem,
      severity: "WARNING",
      message: `Metric ${h.key}=${v} indicates ${h.problem}`,
      source: "metric",
      recommended_action: actionFor(h.problem),
    });
  }

  return out;
}

export async function writeFailureLocalization(opts: {
  projectRoot: string;
  dual?: DualJudgeResult | null;
  cvFindings?: Array<{
    id?: string;
    severity?: string;
    type?: string;
    message?: string;
    related_layers?: string[];
    recommended_action?: string;
  }>;
  metrics?: Record<string, number>;
  passed?: boolean;
}): Promise<FailureLocalizationReport> {
  const root = path.resolve(opts.projectRoot);
  const layers = await loadLayers(root);
  const findings = localizeFailures({
    layers,
    cvFindings: opts.cvFindings,
    vlm: opts.dual?.vlm ?? null,
    metrics: {
      ...(opts.metrics ?? {}),
      ...(opts.dual?.cv.metrics ?? {}),
      ...(opts.dual?.vlm?.scores as Record<string, number> | undefined),
    },
  });
  const report: FailureLocalizationReport = {
    version: "0.1",
    timestamp: new Date().toISOString(),
    passed: opts.passed ?? findings.every((f) => f.severity !== "ERROR"),
    findings,
    policy:
      "Each finding maps to layer_id + DESIGN §7.13 problem_type; dry-run uses CV/VLM/metric heuristics",
  };
  const dir = path.join(root, "validation");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "failure_localization.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  return report;
}
