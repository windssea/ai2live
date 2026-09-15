import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createStableId, type ValidationFinding } from "@ai2live/domain";

/** Minimal pose grid for M4 — parameter contract snapshots (no Cubism runtime required). */
export const DEFAULT_POSE_GRID: Record<string, number>[] = [
  {},
  { ParamAngleX: -30 },
  { ParamAngleX: 30 },
  { ParamAngleY: -30 },
  { ParamAngleY: 30 },
  { ParamAngleZ: -30 },
  { ParamAngleZ: 30 },
  { ParamMouthOpenY: 1 },
  { ParamEyeLOpen: 0, ParamEyeROpen: 0 },
];

function poseLabel(pose: Record<string, number>): string {
  const keys = Object.keys(pose);
  if (!keys.length) return "neutral";
  return keys.map((k) => `${k}=${pose[k]}`).join(" ");
}

/**
 * Parameter-contract screenshots: annotated composites from recomposed PNG.
 * Better than empty stub when no real Live2D renderer is available.
 */
export async function renderPoseGridStub(opts: {
  projectRoot: string;
  sourcePreview?: string;
}): Promise<{ shots: { pose: Record<string, number>; path: string; label: string }[]; gridDir: string }> {
  const root = path.resolve(opts.projectRoot);
  const gridDir = path.join(root, "validation", "pose_grid");
  await mkdir(gridDir, { recursive: true });
  const src =
    opts.sourcePreview ?? path.join(root, "previews", "recomposed_neutral.png");
  let base: Buffer;
  let bw = 256;
  let bh = 256;
  try {
    await access(src);
    base = await readFile(src);
    const meta = await sharp(base).metadata();
    bw = meta.width ?? 256;
    bh = meta.height ?? 256;
  } catch {
    base = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 40, g: 40, b: 50, alpha: 255 } },
    })
      .png()
      .toBuffer();
  }

  const shots: { pose: Record<string, number>; path: string; label: string }[] = [];
  let i = 0;
  for (const pose of DEFAULT_POSE_GRID) {
    const name = `pose_${String(i).padStart(2, "0")}.png`;
    const label = poseLabel(pose);
    const dx = Math.round((pose.ParamAngleX ?? 0) / 3);
    const dy = Math.round((pose.ParamAngleY ?? 0) / 3);
    const mouth = pose.ParamMouthOpenY ?? 0;
    const eyesClosed =
      pose.ParamEyeLOpen === 0 && pose.ParamEyeROpen === 0;

    // Tint / shift encode the parameter contract visually
    const overlayColor =
      mouth > 0
        ? { r: 220, g: 80, b: 100, alpha: 0.35 }
        : eyesClosed
          ? { r: 40, g: 40, b: 60, alpha: 0.4 }
          : { r: 255, g: 80, b: 40, alpha: 0.2 };

    const shifted = await sharp(base)
      .resize(bw, bh)
      .extend({
        top: Math.max(0, dy),
        bottom: Math.max(0, -dy),
        left: Math.max(0, dx),
        right: Math.max(0, -dx),
        background: { r: 255, g: 0, b: 0, alpha: 32 },
      })
      .resize(bw, bh)
      .ensureAlpha()
      .raw()
      .toBuffer();

    // Draw parameter badge strip at top
    const rgba = Buffer.from(shifted);
    const stripH = Math.max(18, Math.round(bh * 0.08));
    for (let y = 0; y < stripH; y++) {
      for (let x = 0; x < bw; x++) {
        const idx = (y * bw + x) * 4;
        const a = overlayColor.alpha;
        rgba[idx] = Math.round(rgba[idx]! * (1 - a) + overlayColor.r * a);
        rgba[idx + 1] = Math.round(rgba[idx + 1]! * (1 - a) + overlayColor.g * a);
        rgba[idx + 2] = Math.round(rgba[idx + 2]! * (1 - a) + overlayColor.b * a);
        rgba[idx + 3] = 255;
      }
    }
    // Side marker bars encode angle magnitude
    const barW = Math.max(4, Math.round(Math.abs(pose.ParamAngleX ?? pose.ParamAngleZ ?? 0) / 5));
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < barW; x++) {
        const idx = (y * bw + x) * 4;
        rgba[idx] = 255;
        rgba[idx + 1] = 200;
        rgba[idx + 2] = 40;
        rgba[idx + 3] = 255;
      }
    }

    // Compose with SVG text label (parameter contract annotation)
    const svg = Buffer.from(
      `<svg width="${bw}" height="${bh}">
        <rect x="0" y="${bh - stripH}" width="${bw}" height="${stripH}" fill="rgba(0,0,0,0.65)"/>
        <text x="8" y="${bh - Math.round(stripH * 0.35)}" font-size="${Math.max(10, Math.round(stripH * 0.55))}" fill="#fff" font-family="monospace">${label.replace(/[<>&]/g, "")}</text>
      </svg>`
    );
    const annotated = await sharp(rgba, { raw: { width: bw, height: bh, channels: 4 } })
      .png()
      .composite([{ input: svg, top: 0, left: 0 }])
      .png()
      .toBuffer();

    await writeFile(path.join(gridDir, name), annotated);
    await writeFile(
      path.join(gridDir, name.replace(".png", ".json")),
      JSON.stringify(
        {
          pose,
          label,
          contract: "parameter_screenshot_composite",
          note: "Annotated from recomposed PNG — not a live Cubism render",
        },
        null,
        2
      )
    );
    shots.push({
      pose,
      path: path.posix.join("validation/pose_grid", name),
      label,
    });
    i++;
  }

  await writeFile(
    path.join(gridDir, "contract.json"),
    JSON.stringify(
      {
        version: "0.2",
        kind: "parameter_contract_screenshots",
        source: src,
        poses: shots.map((s) => ({ path: s.path, pose: s.pose, label: s.label })),
        note: "No Live2D renderer — composites annotate Param* contracts on recomposed PNG",
      },
      null,
      2
    )
  );

  return { shots, gridDir };
}

export interface DiagnosisResult {
  findings: ValidationFinding[];
  recommended_repairs: { action: string; target?: string; reason: string }[];
}

/** Heuristic diagnosis from pose-grid contract metadata. */
export async function diagnosePoseGrid(opts: {
  projectRoot: string;
}): Promise<DiagnosisResult> {
  const root = path.resolve(opts.projectRoot);
  const gridDir = path.join(root, "validation", "pose_grid");
  const findings: ValidationFinding[] = [];
  const recommended_repairs: DiagnosisResult["recommended_repairs"] = [];

  try {
    await access(gridDir);
  } catch {
    findings.push({
      id: createStableId("finding", "no-grid"),
      severity: "WARNING",
      type: "POSE_GRID_MISSING",
      message: "No pose grid; run repair:pose-grid first",
    });
    return { findings, recommended_repairs };
  }

  let shotCount = 0;
  try {
    const contract = JSON.parse(await readFile(path.join(gridDir, "contract.json"), "utf8")) as {
      poses?: unknown[];
    };
    shotCount = contract.poses?.length ?? 0;
  } catch {
    shotCount = DEFAULT_POSE_GRID.length;
  }

  findings.push({
    id: createStableId("finding", "pose-contract"),
    severity: "INFO",
    type: "POSE_GRID_CONTRACT",
    message: `Parameter-contract screenshots present (${shotCount}). Connect AutoLive2d/psd2live for real renders.`,
    backend: "composite_annotation",
  });
  recommended_repairs.push({
    action: "expand_hidden_completion",
    target: "FRONT_HAIR",
    reason: "Head X extremes often expose unpainted forehead under bangs",
  });
  recommended_repairs.push({
    action: "feather_mask",
    target: "EYE",
    reason: "Eye-close contract may show hard ROI edges without feather",
  });

  const report = {
    findings,
    recommended_repairs,
    timestamp: new Date().toISOString(),
    pose_grid_kind: "parameter_contract_screenshots",
  };
  await mkdir(path.join(root, "validation"), { recursive: true });
  await writeFile(path.join(root, "validation", "diagnosis.json"), JSON.stringify(report, null, 2));
  await writeFile(
    path.join(root, "validation", "pose_qa_findings.json"),
    JSON.stringify(
      {
        version: "0.1",
        findings,
        recommended_repairs,
        note: "Pose QA without live renderer — contract composites + heuristic findings",
      },
      null,
      2
    )
  );
  return report;
}

export async function runRepairLoopStub(opts: {
  projectRoot: string;
  maxIters?: number;
}): Promise<{ iterations: number; stopped_reason: string }> {
  const maxIters = opts.maxIters ?? 3;
  await renderPoseGridStub({ projectRoot: opts.projectRoot });
  const diag = await diagnosePoseGrid({ projectRoot: opts.projectRoot });
  await writeFile(
    path.join(opts.projectRoot, "validation", "repair_plan.json"),
    JSON.stringify(
      {
        maxIters,
        iterations_planned: Math.min(maxIters, diag.recommended_repairs.length || 1),
        repairs: diag.recommended_repairs,
        note: "Agent repair loop stub — apply repairs via occlusion/expression tools in later wiring",
      },
      null,
      2
    )
  );
  return { iterations: 0, stopped_reason: "stub_plan_only" };
}
