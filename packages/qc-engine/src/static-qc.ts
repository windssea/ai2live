import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createStableId, type LayerManifest, type ValidationReport, type ValidationFinding } from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";
import { recomposeNeutral } from "@ai2live/psd-compiler";

export interface StaticQcOptions {
  projectRoot: string;
  manifestPath?: string;
  masterPath?: string;
  /** Max allowed mean absolute error on RGB where alpha>0 (0-255 scale). Default 8 */
  maeThreshold?: number;
  /** Max MSE. Default 200 */
  mseThreshold?: number;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function runStaticQc(options: StaticQcOptions): Promise<ValidationReport> {
  const projectRoot = path.resolve(options.projectRoot);
  const manifestPath =
    options.manifestPath ?? path.join(projectRoot, "spec", "layer_manifest.json");
  const maeThreshold = options.maeThreshold ?? 8;
  const mseThreshold = options.mseThreshold ?? 200;

  const raw = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = assertLayerManifest(raw) as LayerManifest;
  const { width, height } = manifest.canvas;

  const masterCandidates = [
    options.masterPath,
    path.join(projectRoot, "design", "master_neutral.png"),
    path.join(projectRoot, "design", "master.png"),
  ].filter(Boolean) as string[];

  let masterPath: string | undefined;
  for (const c of masterCandidates) {
    if (await fileExists(c)) {
      masterPath = c;
      break;
    }
  }

  const findings: ValidationFinding[] = [];
  const recomposed = await recomposeNeutral(projectRoot, manifest);

  const previewDir = path.join(projectRoot, "previews");
  await mkdir(previewDir, { recursive: true });
  const recomposedPath = path.join(previewDir, "recomposed_neutral.png");
  await writeFile(recomposedPath, recomposed.png);

  const metrics: Record<string, number> = {
    canvas_width: width,
    canvas_height: height,
    layer_count: manifest.layers.length,
  };

  if (!masterPath) {
    findings.push({
      id: createStableId("finding", "no-master"),
      severity: "WARNING",
      type: "MISSING_MASTER",
      message: "No master_neutral.png found; skipped composite fidelity compare",
      recommended_action: "Add design/master_neutral.png for Gate 3 composite QA",
    });
  } else {
    const masterRaw = await sharp(masterPath)
      .ensureAlpha()
      .resize(width, height, { fit: "fill" })
      .raw()
      .toBuffer();
    const compRaw = await sharp(recomposed.png).ensureAlpha().raw().toBuffer();

    let sumSq = 0;
    let sumAbs = 0;
    let maxAbs = 0;
    let compared = 0;
    let alphaMismatch = 0;

    for (let i = 0; i < masterRaw.length; i += 4) {
      const ma = masterRaw[i + 3];
      const ca = compRaw[i + 3];
      if (Math.abs(ma - ca) > 16) alphaMismatch += 1;
      // Compare opaque-ish pixels from master
      if (ma < 8 && ca < 8) continue;
      for (let c = 0; c < 3; c++) {
        const d = masterRaw[i + c] - compRaw[i + c];
        sumSq += d * d;
        sumAbs += Math.abs(d);
        maxAbs = Math.max(maxAbs, Math.abs(d));
        compared += 1;
      }
    }

    const mse = compared ? sumSq / compared : 0;
    const mae = compared ? sumAbs / compared : 0;
    const psnr = mse <= 1e-9 ? 99 : 10 * Math.log10((255 * 255) / mse);
    const alphaMismatchRatio = alphaMismatch / (width * height);

    metrics.mse = mse;
    metrics.mae = mae;
    metrics.psnr = psnr;
    metrics.max_abs_diff = maxAbs;
    metrics.alpha_mismatch_ratio = alphaMismatchRatio;
    metrics.compared_pixels = compared;

    if (mae > maeThreshold || mse > mseThreshold) {
      findings.push({
        id: createStableId("finding", "composite-fail"),
        severity: "ERROR",
        type: "COMPOSITE_MISMATCH",
        message: `Recomposed vs master MAE=${mae.toFixed(2)} MSE=${mse.toFixed(2)} (thresholds MAE<=${maeThreshold} MSE<=${mseThreshold})`,
        hypothesis: "Layer stack does not reconstruct master_neutral",
        recommended_action: "Check layer PNGs, z-order, and alpha coverage",
        related_layers: manifest.layers.map((l) => l.id),
      });
    } else {
      findings.push({
        id: createStableId("finding", "composite-ok"),
        severity: "INFO",
        type: "COMPOSITE_OK",
        message: `Composite fidelity OK MAE=${mae.toFixed(2)} PSNR=${psnr.toFixed(1)}`,
      });
    }
  }

  // Schema / structure checks
  const ids = new Set<string>();
  for (const layer of manifest.layers) {
    if (ids.has(layer.id)) {
      findings.push({
        id: createStableId("finding", `dup-${layer.id}`),
        severity: "ERROR",
        type: "DUPLICATE_LAYER_ID",
        related_layers: [layer.id],
        message: `Duplicate layer id ${layer.id}`,
      });
    }
    ids.add(layer.id);
    if (!layer.source.asset_path) {
      findings.push({
        id: createStableId("finding", `path-${layer.id}`),
        severity: "ERROR",
        type: "MISSING_ASSET_PATH",
        related_layers: [layer.id],
        message: `Layer ${layer.id} has no asset_path`,
      });
    } else {
      const abs = path.join(projectRoot, layer.source.asset_path);
      if (!(await fileExists(abs))) {
        findings.push({
          id: createStableId("finding", `miss-${layer.id}`),
          severity: "ERROR",
          type: "MISSING_ASSET_FILE",
          related_layers: [layer.id],
          message: `Missing file ${layer.source.asset_path}`,
        });
      }
    }
  }

  // Gate 6: fold PSD round-trip report if present (written by compilePsd)
  const roundtripPath = path.join(projectRoot, "validation", "psd_roundtrip.json");
  if (await fileExists(roundtripPath)) {
    try {
      const rt = JSON.parse(await readFile(roundtripPath, "utf8")) as {
        passed?: boolean;
        findings?: ValidationFinding[];
        read_leaf_count?: number;
        expected_leaf_count?: number;
      };
      metrics.psd_roundtrip_passed = rt.passed ? 1 : 0;
      if (typeof rt.read_leaf_count === "number") metrics.psd_roundtrip_leaf_count = rt.read_leaf_count;
      if (typeof rt.expected_leaf_count === "number") {
        metrics.psd_roundtrip_expected_count = rt.expected_leaf_count;
      }
      if (Array.isArray(rt.findings)) {
        for (const f of rt.findings) {
          // Avoid duplicating INFO noise if already present by id
          if (!findings.some((x) => x.id === f.id)) findings.push(f);
        }
      } else if (rt.passed === false) {
        findings.push({
          id: createStableId("finding", "psd-rt-qc"),
          severity: "ERROR",
          type: "PSD_ROUNDTRIP_STRUCTURAL_LOSS",
          message: "PSD round-trip failed (see validation/psd_roundtrip.json)",
          recommended_action: "Recompile and inspect layer groups",
        });
      }
    } catch {
      /* ignore malformed roundtrip report */
    }
  }

  const passed = !findings.some((f) => f.severity === "ERROR");
  const report: ValidationReport = {
    id: createStableId("vr", `${manifest.id}-static`),
    version: "0.1",
    project_path: projectRoot,
    timestamp: new Date().toISOString(),
    passed,
    gate: "STATIC_QC",
    metrics,
    findings,
    artifacts: {
      recomposed_neutral: path.relative(projectRoot, recomposedPath),
      ...(masterPath ? { master_neutral: path.relative(projectRoot, masterPath) } : {}),
    },
  };

  const validationDir = path.join(projectRoot, "validation");
  await mkdir(validationDir, { recursive: true });
  await writeFile(path.join(validationDir, "report.json"), JSON.stringify(report, null, 2));

  return report;
}
