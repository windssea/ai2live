/**
 * Image client — talks to local/python worker, provider imageEdit, or in-process stubs.
 */
import { mkdir, writeFile, copyFile, access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  createProvider,
  resolveProviderId,
  isDryRun,
  type ProviderId,
  type ImageEditResult,
} from "@ai2live/model-providers";

export interface SegmentRequest {
  masterPath: string;
  labels?: string[];
  projectRoot?: string;
}

export interface SegmentMask {
  label: string;
  /** Relative path written under masks/ */
  path: string;
  method: "stub_bbox" | "see_through" | "model" | "http_worker";
}

export interface SegmentResult {
  masks: SegmentMask[];
  warnings: string[];
}

export interface ImageEditClientRequest {
  prompt: string;
  inputImagePath: string;
  outputPath?: string;
  maskPath?: string;
  projectRoot?: string;
  provider?: ProviderId | string;
}

export const STUB = false as const;

export function notImplemented(feature: string): never {
  throw new Error(`@ai2live/image-client: ${feature} not implemented`);
}

export function imageWorkerUrl(): string | undefined {
  const v = process.env.AI2LIVE_IMAGE_WORKER_URL;
  return v && v.trim() ? v.replace(/\/$/, "") : undefined;
}

/** Tiny 1x1 PNG for stub mask responses. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * Call configured model provider's imageEdit (grok/openai).
 * Honours AI2LIVE_MODEL_DRY_RUN.
 */
export async function editImageViaProvider(
  req: ImageEditClientRequest
): Promise<ImageEditResult> {
  const providerId = resolveProviderId(req.provider);
  const provider = createProvider(providerId, {
    cwd: req.projectRoot,
  });
  if (!provider.imageEdit) {
    throw new Error(`Provider ${providerId} does not implement imageEdit`);
  }
  return provider.imageEdit({
    prompt: req.prompt,
    inputImagePath: req.inputImagePath,
    maskPath: req.maskPath,
    outputPath: req.outputPath,
    projectRoot: req.projectRoot,
  });
}

/**
 * Optional HTTP backend when AI2LIVE_IMAGE_WORKER_URL is set.
 * Falls back to local stub mask write when worker unreachable and dry-run / no worker.
 */
export async function segmentViaWorker(req: SegmentRequest): Promise<SegmentResult> {
  const base = imageWorkerUrl();
  const warnings: string[] = [];
  const labels = req.labels?.length ? req.labels : ["SUBJECT"];
  const root = req.projectRoot ? path.resolve(req.projectRoot) : process.cwd();
  const masksDir = path.join(root, "masks");
  await mkdir(masksDir, { recursive: true });

  if (base) {
    try {
      const res = await fetch(`${base}/segment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          master_path: req.masterPath,
          labels,
        }),
      });
      if (!res.ok) {
        throw new Error(`worker ${res.status}`);
      }
      const data = (await res.json()) as {
        masks?: Array<{ label: string; path?: string; png_b64?: string }>;
        warnings?: string[];
      };
      const masks: SegmentMask[] = [];
      for (const m of data.masks ?? []) {
        const rel = m.path ?? path.posix.join("masks", `${m.label.toLowerCase()}_mask.png`);
        const abs = path.join(root, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        if (m.png_b64) {
          await writeFile(abs, Buffer.from(m.png_b64, "base64"));
        } else {
          await writeFile(abs, TINY_PNG);
        }
        masks.push({ label: m.label, path: rel, method: "http_worker" });
      }
      return { masks, warnings: [...warnings, ...(data.warnings ?? [])] };
    } catch (err) {
      warnings.push(
        `image worker unavailable (${(err as Error).message}); using stub masks`
      );
    }
  }

  // Local stub masks
  const masks: SegmentMask[] = [];
  for (const label of labels) {
    const rel = path.posix.join("masks", `${label.toLowerCase()}_mask.png`);
    const abs = path.join(root, rel);
    await writeFile(abs, TINY_PNG);
    masks.push({ label, path: rel, method: "stub_bbox" });
  }
  if (!base) {
    warnings.push("AI2LIVE_IMAGE_WORKER_URL unset; stub_bbox masks written");
  }
  return { masks, warnings };
}

/** @deprecated Prefer minRegionInpaint — kept for callers that only need worker POST. */
export async function inpaintViaWorker(opts: {
  imagePath: string;
  maskPath: string;
  outputPath?: string;
  projectRoot?: string;
}): Promise<{ outputPath: string; method: string }> {
  const { minRegionInpaint } = await import("./inpaint.js");
  const r = await minRegionInpaint({
    imagePath: opts.imagePath,
    maskPath: opts.maskPath,
    outputPath: opts.outputPath,
    projectRoot: opts.projectRoot,
    forceLocal: true,
    dryRun: true,
  });
  return { outputPath: r.outputPath, method: r.method };
}

export {
  minRegionInpaint,
  neighborBlendFiles,
  type MinRegionInpaintRequest,
  type MinRegionInpaintResult,
  type InpaintCompletionMethod,
} from "./inpaint.js";

export { readFile };
