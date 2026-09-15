/**
 * Min-region inpaint interface.
 *
 * Priority:
 *  1. Live: provider.imageEdit(mask + edit-delta prompt) → method `image_edit`
 *  2. Dry-run / no provider: Python worker OpenCV TELEA/NS or telea-like → `opencv_inpaint` | mapped
 *  3. Failure / no worker: in-process neighbor blend → `neighbor_blend`
 */
import { mkdir, writeFile, copyFile, access, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createProvider,
  resolveProviderId,
  isDryRun,
  type ProviderId,
} from "@ai2live/model-providers";

function imageWorkerUrl(): string | undefined {
  const v = process.env.AI2LIVE_IMAGE_WORKER_URL;
  return v && v.trim() ? v.replace(/\/$/, "") : undefined;
}

/** Provenance labels requested by DESIGN gap-fill DoD. */
export type InpaintCompletionMethod =
  | "image_edit"
  | "opencv_inpaint"
  | "neighbor_blend"
  /** Worker telea-like without OpenCV — reported under opencv_inpaint family or neighbor. */
  | "telea_like";

export interface MinRegionInpaintRequest {
  /** Full-canvas (or crop) source image. */
  imagePath: string;
  /** Mask: white/opaque = hidden region to fill (+ feather already applied by caller). */
  maskPath: string;
  outputPath?: string;
  projectRoot?: string;
  /** Edit-delta prompt for live provider.imageEdit. */
  prompt?: string;
  provider?: ProviderId | string;
  /** Force skip provider even if configured. */
  forceLocal?: boolean;
  dryRun?: boolean;
}

export interface MinRegionInpaintResult {
  outputPath: string;
  /** Canonical DoD method (telea_like maps to opencv_inpaint-family for reports). */
  completion_method: "image_edit" | "opencv_inpaint" | "neighbor_blend";
  /** Raw backend method for debugging. */
  method: InpaintCompletionMethod | string;
  dry_run: boolean;
  note?: string;
  prompt_hash?: string;
}

function mapMethod(raw: string): "image_edit" | "opencv_inpaint" | "neighbor_blend" {
  if (raw === "image_edit" || raw === "provider_image_edit") return "image_edit";
  if (raw === "opencv_inpaint" || raw === "telea_like" || raw === "http_worker") {
    return "opencv_inpaint";
  }
  return "neighbor_blend";
}

/** In-process multi-scale neighbor blend (same heuristic as occlusion fallback). */
export async function neighborBlendFiles(opts: {
  imagePath: string;
  maskPath: string;
  outputPath: string;
}): Promise<void> {
  const img = sharp(opts.imagePath).ensureAlpha();
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("invalid image dimensions");
  const baseRgba = await img.raw().toBuffer();
  const maskRgba = await sharp(opts.maskPath)
    .ensureAlpha()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();

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
        out[i] = 255;
        out[i + 1] = 220;
        out[i + 2] = 190;
        out[i + 3] = 200;
      }
    }
  }
  // Soft border
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
  await mkdir(path.dirname(opts.outputPath), { recursive: true });
  await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(opts.outputPath);
}

async function tryWorkerInpaint(opts: {
  imagePath: string;
  maskPath: string;
  outputPath: string;
}): Promise<{ method: string; note?: string } | null> {
  const base = imageWorkerUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/inpaint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_path: opts.imagePath,
        mask_path: opts.maskPath,
      }),
    });
    if (!res.ok) throw new Error(`worker ${res.status}`);
    const data = (await res.json()) as {
      png_b64?: string;
      method?: string;
      note?: string;
      error?: string;
    };
    if (!data.png_b64 || data.method === "stub" || data.error) {
      return null;
    }
    await mkdir(path.dirname(opts.outputPath), { recursive: true });
    await writeFile(opts.outputPath, Buffer.from(data.png_b64, "base64"));
    return { method: data.method ?? "http_worker", note: data.note };
  } catch {
    return null;
  }
}

/**
 * Min-region inpaint: image + mask → filled image with clear completion_method provenance.
 */
export async function minRegionInpaint(
  req: MinRegionInpaintRequest
): Promise<MinRegionInpaintResult> {
  if (req.dryRun) process.env.AI2LIVE_MODEL_DRY_RUN = "1";
  const root = req.projectRoot ? path.resolve(req.projectRoot) : process.cwd();
  const outputPath =
    req.outputPath ?? path.join(root, "previews", `inpaint_${Date.now()}.png`);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const dry = isDryRun() || Boolean(req.dryRun);
  const prompt = req.prompt ?? "Edit Delta only: fill ONLY the masked hidden region; keep identity.";

  // Live path: provider.imageEdit
  if (!req.forceLocal && !dry) {
    try {
      const providerId = resolveProviderId(req.provider);
      const provider = createProvider(providerId, { cwd: root });
      if (provider.imageEdit) {
        const edited = await provider.imageEdit({
          prompt,
          inputImagePath: req.imagePath,
          maskPath: req.maskPath,
          outputPath,
          projectRoot: root,
        });
        if (!edited.dryRun) {
          if (path.resolve(edited.outputPath) !== path.resolve(outputPath)) {
            await copyFile(edited.outputPath, outputPath);
          }
          return {
            outputPath,
            completion_method: "image_edit",
            method: "image_edit",
            dry_run: false,
            note: `provider.imageEdit via ${provider.id}`,
          };
        }
        // dry-run from provider — fall through to local CV path
      }
    } catch (err) {
      // fall through to local; note failure
      const worker = await tryWorkerInpaint({
        imagePath: req.imagePath,
        maskPath: req.maskPath,
        outputPath,
      });
      if (worker) {
        return {
          outputPath,
          completion_method: mapMethod(worker.method),
          method: worker.method,
          dry_run: dry,
          note: `imageEdit failed (${(err as Error).message}); worker ${worker.method}`,
        };
      }
      await neighborBlendFiles({
        imagePath: req.imagePath,
        maskPath: req.maskPath,
        outputPath,
      });
      return {
        outputPath,
        completion_method: "neighbor_blend",
        method: "neighbor_blend",
        dry_run: dry,
        note: `imageEdit failed (${(err as Error).message}); fell back to neighbor_blend`,
      };
    }
  }

  // Dry-run / local: prefer worker OpenCV / telea-like
  const worker = await tryWorkerInpaint({
    imagePath: req.imagePath,
    maskPath: req.maskPath,
    outputPath,
  });
  if (worker) {
    return {
      outputPath,
      completion_method: mapMethod(worker.method),
      method: worker.method,
      dry_run: dry,
      note: worker.note ?? `worker ${worker.method}`,
    };
  }

  // Final fallback: in-process neighbor blend
  try {
    await access(req.imagePath);
    await access(req.maskPath);
    await neighborBlendFiles({
      imagePath: req.imagePath,
      maskPath: req.maskPath,
      outputPath,
    });
    return {
      outputPath,
      completion_method: "neighbor_blend",
      method: "neighbor_blend",
      dry_run: dry,
      note: imageWorkerUrl()
        ? "Worker unavailable/stub; in-process neighbor_blend"
        : "AI2LIVE_IMAGE_WORKER_URL unset; in-process neighbor_blend (install opencv-python-headless + worker for TELEA)",
    };
  } catch (err) {
    try {
      await access(req.imagePath);
      await copyFile(req.imagePath, outputPath);
    } catch {
      await writeFile(outputPath, await readFile(req.imagePath).catch(() => Buffer.alloc(0)));
    }
    return {
      outputPath,
      completion_method: "neighbor_blend",
      method: "neighbor_blend",
      dry_run: dry,
      note: `neighbor_blend failed (${(err as Error).message}); copied input`,
    };
  }
}
