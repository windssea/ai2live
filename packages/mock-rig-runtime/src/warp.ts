/**
 * Mesh-ish / piecewise affine warp for HeadX/Y extremes from layered PNGs.
 * Better than flat annotate: layers shear/translate by semantic weights so
 * bangs / face / body diverge under ParamAngleX/Y like a crude Live2D preview.
 */
import sharp from "sharp";
import { access, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MockRigLayer, MockRigPose, MockRigRenderRequest, MockRigRenderResult } from "./types.js";

function semWeight(semantic?: string): { tx: number; ty: number; shear: number; scaleY: number } {
  const s = (semantic ?? "").toUpperCase();
  if (s.includes("FRONT_HAIR") || s.includes("BANG") || s === "HAIR_FRONT") {
    return { tx: 1.35, ty: 0.55, shear: 0.9, scaleY: 0.15 };
  }
  if (s.includes("BACK_HAIR") || s.includes("HAIR_BACK") || s === "HAIR") {
    return { tx: 0.85, ty: 0.35, shear: 0.55, scaleY: 0.1 };
  }
  if (s.includes("FACE") || s.includes("HEAD") || s.includes("BROW")) {
    return { tx: 1.0, ty: 0.85, shear: 0.7, scaleY: 0.2 };
  }
  if (s.includes("EYE") || s.includes("PUPIL") || s.includes("LASH")) {
    return { tx: 1.05, ty: 0.9, shear: 0.65, scaleY: 0.25 };
  }
  if (s.includes("MOUTH") || s.includes("NOSE")) {
    return { tx: 0.95, ty: 1.0, shear: 0.5, scaleY: 0.35 };
  }
  if (s.includes("ARM") || s.includes("HAND")) {
    return { tx: 0.25, ty: 0.1, shear: 0.15, scaleY: 0.05 };
  }
  if (s.includes("BODY") || s.includes("TORSO") || s.includes("CLOTH")) {
    return { tx: 0.15, ty: 0.05, shear: 0.08, scaleY: 0.02 };
  }
  return { tx: 0.6, ty: 0.4, shear: 0.4, scaleY: 0.1 };
}

function defaultPivot(semantic?: string): { x: number; y: number } {
  const s = (semantic ?? "").toUpperCase();
  if (s.includes("ARM") || s.includes("HAND") || s.includes("BODY")) return { x: 0.5, y: 0.72 };
  if (s.includes("MOUTH")) return { x: 0.5, y: 0.58 };
  if (s.includes("EYE")) return { x: 0.5, y: 0.38 };
  return { x: 0.5, y: 0.42 }; // head/face/hair
}

/**
 * Apply horizontal shear + translate + mild vertical squash based on angle params.
 * Operates on raw RGBA buffer in-place-ish (returns new buffer).
 */
export function warpRgba(
  rgba: Buffer,
  width: number,
  height: number,
  pose: MockRigPose,
  semantic?: string,
  pivotNorm?: { x: number; y: number }
): Buffer {
  const wgt = semWeight(semantic);
  const pivot = pivotNorm ?? defaultPivot(semantic);
  const ax = (pose.ParamAngleX ?? 0) / 30; // ~[-1,1] at extremes
  const ay = (pose.ParamAngleY ?? 0) / 30;
  const az = (pose.ParamAngleZ ?? 0) / 30;
  const mouth = pose.ParamMouthOpenY ?? 0;
  const eyesClosed = pose.ParamEyeLOpen === 0 && pose.ParamEyeROpen === 0;

  const shearX = ax * wgt.shear * 0.22; // dx per unit y
  const transX = ax * wgt.tx * width * 0.06;
  const transY = -ay * wgt.ty * height * 0.05;
  const scaleY = 1 + ay * wgt.scaleY * 0.12 + (mouth > 0 && (semantic ?? "").toUpperCase().includes("MOUTH") ? 0.18 * mouth : 0);
  const rotZ = az * 0.08 * wgt.shear; // tiny rotate approx via shear

  const px = pivot.x * width;
  const py = pivot.y * height;

  const out = Buffer.alloc(width * height * 4, 0);
  // Inverse map for each dest pixel
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // undo transform around pivot
      let lx = x - px - transX;
      let ly = y - py - transY;
      // undo scaleY
      ly = ly / (scaleY || 1);
      // undo shearX (x' = x + shear * y)
      lx = lx - shearX * ly;
      // undo tiny Z as additional shear on x from y and y from x
      const rx = lx - rotZ * ly;
      const ry = ly + rotZ * lx * 0.5;
      const sx = rx + px;
      const sy = ry + py;

      // Eye-close: darken eye region by skipping / alpha-scale when sampling eyes
      const di = (y * width + x) * 4;
      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) {
        continue;
      }
      // Bilinear sample
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const sample = (ix: number, iy: number) => {
        const si = (iy * width + ix) * 4;
        return [rgba[si]!, rgba[si + 1]!, rgba[si + 2]!, rgba[si + 3]!] as const;
      };
      const c00 = sample(x0, y0);
      const c10 = sample(x0 + 1, y0);
      const c01 = sample(x0, y0 + 1);
      const c11 = sample(x0 + 1, y0 + 1);
      for (let c = 0; c < 4; c++) {
        const v =
          c00[c]! * (1 - fx) * (1 - fy) +
          c10[c]! * fx * (1 - fy) +
          c01[c]! * (1 - fx) * fy +
          c11[c]! * fx * fy;
        out[di + c] = Math.round(v);
      }
      if (eyesClosed && (semantic ?? "").toUpperCase().includes("EYE")) {
        out[di + 3] = Math.round(out[di + 3]! * 0.15);
      }
    }
  }
  return out;
}

async function loadLayerPng(
  layerPath: string,
  width: number,
  height: number
): Promise<Buffer | null> {
  try {
    await access(layerPath);
    return await sharp(layerPath)
      .ensureAlpha()
      .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer();
  } catch {
    return null;
  }
}

function compositeOver(dst: Buffer, src: Buffer): void {
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3]! / 255;
    if (sa <= 0) continue;
    const da = dst[i + 3]! / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const sv = src[i + c]!;
      const dv = dst[i + c]!;
      dst[i + c] = Math.round((sv * sa + dv * da * (1 - sa)) / outA);
    }
    dst[i + 3] = Math.round(outA * 255);
  }
}

/**
 * Render a mock mesh-warp pose from layered PNGs.
 */
export async function renderMockRigPose(req: MockRigRenderRequest): Promise<MockRigRenderResult> {
  const width = req.width ?? 512;
  const height = req.height ?? 512;
  const layers = [...req.layers].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0));
  const canvas = Buffer.alloc(width * height * 4, 0);
  // neutral dark bg
  for (let i = 0; i < width * height; i++) {
    canvas[i * 4] = 28;
    canvas[i * 4 + 1] = 28;
    canvas[i * 4 + 2] = 36;
    canvas[i * 4 + 3] = 255;
  }

  let used = 0;
  for (const layer of layers) {
    const abs = path.isAbsolute(layer.path)
      ? layer.path
      : path.join(req.projectRoot, layer.path);
    const rgba = await loadLayerPng(abs, width, height);
    if (!rgba) continue;
    const warped = warpRgba(rgba, width, height, req.pose, layer.semantic, layer.pivot);
    compositeOver(canvas, warped);
    used++;
  }

  // If no layers loaded, still produce annotated blank with pose strip
  const label = req.label ?? poseLabel(req.pose);
  const stripH = Math.max(20, Math.round(height * 0.07));
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}">
      <rect x="0" y="0" width="${width}" height="${stripH}" fill="rgba(0,0,0,0.55)"/>
      <text x="10" y="${Math.round(stripH * 0.7)}" font-size="${Math.max(11, Math.round(stripH * 0.55))}" fill="#ffe08a" font-family="monospace">mock-rig ${escapeXml(label)}</text>
      <rect x="0" y="${height - stripH}" width="${width}" height="${stripH}" fill="rgba(0,0,0,0.55)"/>
      <text x="10" y="${height - Math.round(stripH * 0.3)}" font-size="${Math.max(10, Math.round(stripH * 0.5))}" fill="#9fd" font-family="monospace">mesh-warp layers=${used}</text>
    </svg>`
  );

  await mkdir(path.dirname(req.outputPath), { recursive: true });
  await sharp(canvas, { raw: { width, height, channels: 4 } })
    .png()
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toFile(req.outputPath);

  return {
    outputPath: req.outputPath,
    width,
    height,
    kind: "mock_mesh_warp",
    pose: req.pose,
    layers_used: used,
    note: "Mock mesh-ish warp from layered PNGs — not Cubism/AutoLive2d",
  };
}

function poseLabel(pose: MockRigPose): string {
  const keys = Object.keys(pose).filter((k) => pose[k] != null);
  if (!keys.length) return "neutral";
  return keys.map((k) => `${k}=${pose[k]}`).join(" ");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, "");
}

/** Discover layer PNGs from a project (layers/*.png or layer_manifest). */
export async function discoverProjectLayers(projectRoot: string): Promise<MockRigLayer[]> {
  const root = path.resolve(projectRoot);
  const layers: MockRigLayer[] = [];
  // Prefer layer_manifest.json
  try {
    const manPath = path.join(root, "layer_manifest.json");
    await access(manPath);
    const man = JSON.parse(await readFile(manPath, "utf8")) as {
      layers?: Array<{
        id?: string;
        uuid?: string;
        semantic?: string;
        z_index?: number;
        png?: string;
        path?: string;
        asset_path?: string;
      }>;
    };
    for (const l of man.layers ?? []) {
      const rel = l.png ?? l.path ?? l.asset_path;
      if (!rel) continue;
      layers.push({
        id: String(l.id ?? l.uuid ?? rel),
        path: rel,
        semantic: l.semantic,
        z_index: l.z_index,
      });
    }
    if (layers.length) return layers;
  } catch {
    /* fall through */
  }
  // Fallback: layers/ directory
  try {
    const { readdir } = await import("node:fs/promises");
    const dir = path.join(root, "layers");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".png"));
    let z = 0;
    for (const f of files.sort()) {
      const sem = f.replace(/\.png$/i, "").toUpperCase();
      layers.push({
        id: f,
        path: path.posix.join("layers", f),
        semantic: sem,
        z_index: z++,
      });
    }
  } catch {
    /* empty */
  }
  // Last resort: single recomposed preview
  if (!layers.length) {
    const preview = path.join(root, "previews", "recomposed_neutral.png");
    try {
      await access(preview);
      layers.push({
        id: "recomposed",
        path: path.posix.join("previews", "recomposed_neutral.png"),
        semantic: "FACE",
        z_index: 0,
      });
    } catch {
      /* none */
    }
  }
  return layers;
}

export async function renderPoseGridMockRig(opts: {
  projectRoot: string;
  poses: MockRigPose[];
  outDir?: string;
  width?: number;
  height?: number;
}): Promise<{
  shots: Array<{ pose: MockRigPose; path: string; label: string; layers_used: number }>;
  gridDir: string;
  kind: "mock_mesh_warp";
}> {
  const root = path.resolve(opts.projectRoot);
  const gridDir = opts.outDir ?? path.join(root, "validation", "pose_grid");
  await mkdir(gridDir, { recursive: true });
  const layers = await discoverProjectLayers(root);
  const shots: Array<{ pose: MockRigPose; path: string; label: string; layers_used: number }> = [];
  let i = 0;
  for (const pose of opts.poses) {
    const name = `pose_${String(i).padStart(2, "0")}.png`;
    const label = poseLabel(pose);
    const out = path.join(gridDir, name);
    const r = await renderMockRigPose({
      projectRoot: root,
      layers,
      pose,
      width: opts.width,
      height: opts.height,
      outputPath: out,
      label,
    });
    await writeFile(
      path.join(gridDir, name.replace(".png", ".json")),
      JSON.stringify(
        {
          pose,
          label,
          contract: "mock_mesh_warp",
          layers_used: r.layers_used,
          note: r.note,
        },
        null,
        2
      )
    );
    shots.push({
      pose,
      path: path.posix.join("validation/pose_grid", name),
      label,
      layers_used: r.layers_used,
    });
    i++;
  }
  await writeFile(
    path.join(gridDir, "contract.json"),
    JSON.stringify(
      {
        version: "0.3",
        kind: "mock_mesh_warp",
        layers: layers.map((l) => ({ id: l.id, semantic: l.semantic, path: l.path })),
        poses: shots.map((s) => ({ path: s.path, pose: s.pose, label: s.label, layers_used: s.layers_used })),
        note: "Mock rig mesh-warp from layered PNGs — substitute when Cubism/AutoLive2d unavailable",
      },
      null,
      2
    )
  );
  return { shots, gridDir, kind: "mock_mesh_warp" };
}
