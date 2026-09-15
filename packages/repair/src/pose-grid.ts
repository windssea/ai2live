import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createStableId, type ValidationFinding } from "@ai2live/domain";

/** Minimal pose grid for M4 — synthetic parameter snapshots (no Cubism runtime yet). */
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

export async function renderPoseGridStub(opts: {
  projectRoot: string;
  sourcePreview?: string;
}): Promise<{ shots: { pose: Record<string, number>; path: string }[]; gridDir: string }> {
  const root = path.resolve(opts.projectRoot);
  const gridDir = path.join(root, "validation", "pose_grid");
  await mkdir(gridDir, { recursive: true });
  const src =
    opts.sourcePreview ?? path.join(root, "previews", "recomposed_neutral.png");
  let base: Buffer;
  try {
    await access(src);
    base = await readFile(src);
  } catch {
    base = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
  }

  const shots: { pose: Record<string, number>; path: string }[] = [];
  let i = 0;
  for (const pose of DEFAULT_POSE_GRID) {
    const name = `pose_${String(i).padStart(2, "0")}.png`;
    // Annotate pose as a colored border encoding — placeholder until real renderer exists
    const dx = Math.round((pose.ParamAngleX ?? 0) / 3);
    const dy = Math.round((pose.ParamAngleY ?? 0) / 3);
    const annotated = await sharp(base)
      .resize(256, 256)
      .extend({
        top: Math.max(0, dy),
        bottom: Math.max(0, -dy),
        left: Math.max(0, dx),
        right: Math.max(0, -dx),
        background: { r: 255, g: 0, b: 0, alpha: 32 },
      })
      .resize(256, 256)
      .png()
      .toBuffer();
    await writeFile(path.join(gridDir, name), annotated);
    await writeFile(
      path.join(gridDir, name.replace(".png", ".json")),
      JSON.stringify({ pose }, null, 2)
    );
    shots.push({ pose, path: path.posix.join("validation/pose_grid", name) });
    i++;
  }
  return { shots, gridDir };
}

export interface DiagnosisResult {
  findings: ValidationFinding[];
  recommended_repairs: { action: string; target?: string; reason: string }[];
}

/** Heuristic diagnosis hooks — VLM placeholder that inspects pose grid metadata. */
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

  // Stub: if extreme head X poses exist, suggest hair completion expand
  findings.push({
    id: createStableId("finding", "pose-stub"),
    severity: "INFO",
    type: "POSE_GRID_OK",
    message: "Pose grid present (stub renderer). Connect AutoLive2d/psd2live screenshots in M5.",
    backend: "stub",
  });
  recommended_repairs.push({
    action: "expand_hidden_completion",
    target: "FRONT_HAIR",
    reason: "Head X extremes often expose unpainted forehead under bangs",
  });

  const report = { findings, recommended_repairs, timestamp: new Date().toISOString() };
  await mkdir(path.join(root, "validation"), { recursive: true });
  await writeFile(path.join(root, "validation", "diagnosis.json"), JSON.stringify(report, null, 2));
  return report;
}

export async function runRepairLoopStub(opts: {
  projectRoot: string;
  maxIters?: number;
}): Promise<{ iterations: number; stopped_reason: string }> {
  const maxIters = opts.maxIters ?? 3;
  await renderPoseGridStub({ projectRoot: opts.projectRoot });
  const diag = await diagnosePoseGrid({ projectRoot: opts.projectRoot });
  // M4: do not auto-mutate assets yet — record plan only
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
