import sharp from "sharp";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import type { LayerManifest } from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";

export type OcclusionScenario = "bangs_under_face" | "face_over_back_hair" | "body_over_arm_root";

/**
 * M2 occlusion completion — deterministic stub.
 * Expands the occludee layer into the overlap region by dilating alpha under the occluder bbox
 * and filling with nearby face/body skin tones sampled from the occludee itself (or master).
 * Not ML inpaint — a reproducible geometric completion for the three MVP scenarios.
 */
export async function completeOcclusionScenarios(opts: {
  projectRoot: string;
  scenarios?: OcclusionScenario[];
}): Promise<{ outputs: { scenario: OcclusionScenario; path: string }[]; reportPath: string }> {
  const root = path.resolve(opts.projectRoot);
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
  await mkdir(outDir, { recursive: true });

  const bySemantic = (sem: string, side?: string) =>
    manifest.layers.find(
      (l) =>
        l.semantic.toUpperCase().includes(sem) &&
        (side ? l.side === side : true)
    );

  const outputs: { scenario: OcclusionScenario; path: string }[] = [];

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
    if (!occluder || !occludee || !occludee.source.asset_path || !occluder.canvas_bounds) {
      continue;
    }
    const occludeePath = path.join(root, occludee.source.asset_path);
    try {
      await access(occludeePath);
    } catch {
      continue;
    }

    const base = await sharp(occludeePath).ensureAlpha().resize(width, height).raw().toBuffer();
    const completed = Buffer.from(base);
    const b = occluder.canvas_bounds;
    const x0 = Math.round(b.x * width);
    const y0 = Math.round(b.y * height);
    const x1 = Math.round((b.x + b.w) * width);
    const y1 = Math.round((b.y + b.h) * height);

    // Sample mean opaque color from occludee
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < base.length; i += 4) {
      if (base[i + 3] > 200) {
        sr += base[i]; sg += base[i + 1]; sb += base[i + 2]; n++;
      }
    }
    const fr = n ? Math.round(sr / n) : 255;
    const fg = n ? Math.round(sg / n) : 220;
    const fb = n ? Math.round(sb / n) : 190;

    // Dilate: fill transparent pixels in overlap region with sampled color
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        if (completed[i + 3] < 16) {
          completed[i] = fr;
          completed[i + 1] = fg;
          completed[i + 2] = fb;
          completed[i + 3] = 230;
        }
      }
    }

    const rel = path.posix.join("layers/completions", `${scenario}.png`);
    await sharp(completed, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(path.join(root, rel));
    outputs.push({ scenario, path: rel });
  }

  const reportPath = path.join(root, "layers", "completions", "occlusion_report.json");
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        version: "0.1",
        method: "deterministic_dilate_fill",
        scenarios: outputs,
        note: "M2 stub completion for bangs/face/back-hair/arm-root. Replace with inpaint worker in production.",
      },
      null,
      2
    )
  );
  return { outputs, reportPath };
}
