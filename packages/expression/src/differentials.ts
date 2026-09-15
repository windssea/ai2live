import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { LayerManifest, CanvasBounds } from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";
import {
  createProvider,
  resolveProviderId,
  isDryRun,
  type ModelProvider,
  type ProviderId,
} from "@ai2live/model-providers";
import { minRegionInpaint } from "@ai2live/image-client";

export type ExpressionKind = "mouth_open" | "eye_close" | "smile" | "special_eye";

export type ExpressionMethod =
  | "image_edit"
  | "opencv_inpaint"
  | "neighbor_blend"
  | "provider_image_edit" // legacy
  | "dry_run_roi_morph_stub"
  | "template_composite_stub";

export interface ExpressionDifferentialResult {
  kind: ExpressionKind;
  path: string;
  method: ExpressionMethod;
  completion_method?: "image_edit" | "opencv_inpaint" | "neighbor_blend";
  prompt_hash: string;
  provenance: {
    prompt: string;
    prompt_hash: string;
    method: ExpressionMethod;
    completion_method?: string;
    dry_run: boolean;
    provider?: string;
  };
}

function editDeltaPrompt(kind: ExpressionKind): string {
  const lock =
    "Edit Delta: keep full-character identity, hairstyle, outfit, and proportions. Change ONLY the named facial ROI. Do not regenerate the whole image.";
  switch (kind) {
    case "mouth_open":
      return `${lock} Open the mouth to a natural maximum speaking pose; keep teeth/tongue consistent with style.`;
    case "eye_close":
      return `${lock} Close both eyes with natural lashes; keep brows and face unchanged.`;
    case "smile":
      return `${lock} Soft smile on the mouth only; eyes stay open and identity-locked.`;
    case "special_eye":
      return `${lock} Special-eye highlight/color shift on irises only; keep eye shape.`;
  }
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

/** Soft morph of ROI — used when inpaint path returns empty / as enrichment under mask. */
async function stubRoiMorph(
  masterRgba: Buffer,
  width: number,
  height: number,
  kind: ExpressionKind,
  rois: CanvasBounds[]
): Promise<Buffer> {
  const img = Buffer.from(masterRgba);

  const paint = (
    b: CanvasBounds,
    rgba: [number, number, number, number],
    alphaBlend = 0.55
  ) => {
    const x0 = Math.round(b.x * width);
    const y0 = Math.round(b.y * height);
    const x1 = Math.round((b.x + b.w) * width);
    const y1 = Math.round((b.y + b.h) * height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const tx = (x - x0) / Math.max(1, x1 - x0);
        const ty = (y - y0) / Math.max(1, y1 - y0);
        const edge = Math.min(tx, 1 - tx, ty, 1 - ty);
        const w = Math.min(1, edge * 4) * alphaBlend;
        const i = (y * width + x) * 4;
        img[i] = Math.round(img[i]! * (1 - w) + rgba[0] * w);
        img[i + 1] = Math.round(img[i + 1]! * (1 - w) + rgba[1] * w);
        img[i + 2] = Math.round(img[i + 2]! * (1 - w) + rgba[2] * w);
        img[i + 3] = Math.max(img[i + 3]!, Math.round(rgba[3] * w + img[i + 3]! * (1 - w)));
      }
    }
  };

  if (kind === "mouth_open") {
    for (const b of rois) {
      paint(b, [40, 20, 30, 255], 0.7);
      paint(
        { x: b.x + 0.02, y: b.y + 0.02, w: b.w - 0.04, h: b.h - 0.03 },
        [180, 60, 80, 255],
        0.65
      );
    }
  } else if (kind === "eye_close") {
    for (const b of rois) {
      paint(b, [255, 220, 190, 255], 0.75);
      paint(
        { x: b.x, y: b.y + b.h * 0.42, w: b.w, h: b.h * 0.18 },
        [40, 40, 50, 255],
        0.85
      );
    }
  } else if (kind === "smile") {
    for (const b of rois) {
      paint(b, [255, 220, 190, 255], 0.5);
      paint(
        { x: b.x, y: b.y + b.h * 0.4, w: b.w, h: b.h * 0.35 },
        [200, 80, 100, 255],
        0.6
      );
    }
  } else if (kind === "special_eye") {
    for (const b of rois) {
      paint(b, [220, 40, 180, 255], 0.45);
    }
  }

  return img;
}

function roisForKind(
  kind: ExpressionKind,
  mouth?: { canvas_bounds?: CanvasBounds },
  eyeL?: { canvas_bounds?: CanvasBounds },
  eyeR?: { canvas_bounds?: CanvasBounds }
): CanvasBounds[] {
  if (kind === "mouth_open" || kind === "smile") {
    return mouth?.canvas_bounds ? [mouth.canvas_bounds] : [];
  }
  const eyes = [eyeL?.canvas_bounds, eyeR?.canvas_bounds].filter(Boolean) as CanvasBounds[];
  return eyes;
}

/** Feathered ROI mask (white = edit region). */
function buildRoiMask(
  width: number,
  height: number,
  rois: CanvasBounds[],
  feather = 2
): Buffer {
  const mask = Buffer.alloc(width * height * 4, 0);
  for (const b of rois) {
    const x0 = Math.max(0, Math.round(b.x * width) - feather);
    const y0 = Math.max(0, Math.round(b.y * height) - feather);
    const x1 = Math.min(width, Math.round((b.x + b.w) * width) + feather);
    const y1 = Math.min(height, Math.round((b.y + b.h) * height) + feather);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        // Soft falloff near edge of expanded ROI
        const dx = Math.min(x - x0, x1 - 1 - x);
        const dy = Math.min(y - y0, y1 - 1 - y);
        const edge = Math.min(dx, dy);
        const a = edge < feather ? Math.round(255 * ((edge + 1) / (feather + 1))) : 255;
        mask[i] = mask[i + 1] = mask[i + 2] = 255;
        mask[i + 3] = Math.max(mask[i + 3]!, a);
      }
    }
  }
  return mask;
}

/**
 * M3 expression differentials — prefer min-region inpaint over ROI with Edit Delta prompt.
 */
export async function generateExpressionDifferentials(opts: {
  projectRoot: string;
  kinds?: ExpressionKind[];
  provider?: ModelProvider | ProviderId | string;
  dryRun?: boolean;
  forceStub?: boolean;
}): Promise<{ differentials: ExpressionDifferentialResult[]; reportPath: string }> {
  const root = path.resolve(opts.projectRoot);
  if (opts.dryRun) process.env.AI2LIVE_MODEL_DRY_RUN = "1";

  const kinds = opts.kinds ?? ["mouth_open", "eye_close", "smile", "special_eye"];
  const masterPath = path.join(root, "design", "master_neutral.png");
  const manifest = assertLayerManifest(
    JSON.parse(await readFile(path.join(root, "spec", "layer_manifest.json"), "utf8"))
  ) as LayerManifest;
  const { width, height } = manifest.canvas;
  const outDir = path.join(root, "design", "differentials");
  await mkdir(outDir, { recursive: true });

  const mouth = manifest.layers.find((l) => l.semantic === "MOUTH");
  const eyeL = manifest.layers.find((l) => l.semantic === "EYE" && l.side === "LEFT");
  const eyeR = manifest.layers.find((l) => l.semantic === "EYE" && l.side === "RIGHT");

  let providerId: string | undefined;
  if (!opts.forceStub) {
    if (typeof opts.provider === "object" && opts.provider && "id" in opts.provider) {
      providerId = opts.provider.id;
    } else if (typeof opts.provider === "string") {
      providerId = opts.provider;
    } else {
      try {
        providerId = resolveProviderId();
        createProvider(providerId, { cwd: root });
      } catch {
        providerId = undefined;
      }
    }
  }

  const masterRgba = await sharp(masterPath).ensureAlpha().resize(width, height).raw().toBuffer();
  const differentials: ExpressionDifferentialResult[] = [];

  for (const kind of kinds) {
    const prompt = editDeltaPrompt(kind);
    const prompt_hash = hashPrompt(prompt);
    const rel = path.posix.join("design/differentials", `${kind}.png`);
    const abs = path.join(root, rel);
    const rois = roisForKind(kind, mouth, eyeL, eyeR);

    let method: ExpressionMethod = "dry_run_roi_morph_stub";
    let completion_method: "image_edit" | "opencv_inpaint" | "neighbor_blend" | undefined;

    if (rois.length > 0 && !opts.forceStub) {
      const maskRel = path.posix.join("design/differentials/masks", `${kind}_mask.png`);
      const maskAbs = path.join(root, maskRel);
      await mkdir(path.dirname(maskAbs), { recursive: true });
      const maskRgba = buildRoiMask(width, height, rois, 2);
      await sharp(maskRgba, { raw: { width, height, channels: 4 } }).png().toFile(maskAbs);

      // Seed ROI with morph stub so dry-run/local inpaint has something to blend from
      const seeded = await stubRoiMorph(masterRgba, width, height, kind, rois);
      const seedPath = path.join(outDir, `._${kind}_seed.png`);
      await sharp(seeded, { raw: { width, height, channels: 4 } }).png().toFile(seedPath);

      try {
        const painted = await minRegionInpaint({
          imagePath: seedPath,
          maskPath: maskAbs,
          outputPath: abs,
          projectRoot: root,
          prompt,
          provider: providerId,
          forceLocal: Boolean(opts.forceStub),
          dryRun: opts.dryRun,
        });
        completion_method = painted.completion_method;
        method =
          painted.completion_method === "image_edit"
            ? "image_edit"
            : painted.completion_method === "opencv_inpaint"
              ? "opencv_inpaint"
              : isDryRun() || opts.dryRun
                ? "dry_run_roi_morph_stub"
                : "neighbor_blend";
      } catch {
        await sharp(seeded, { raw: { width, height, channels: 4 } }).png().toFile(abs);
        method = "dry_run_roi_morph_stub";
        completion_method = "neighbor_blend";
      }
    } else {
      const stub = await stubRoiMorph(masterRgba, width, height, kind, rois);
      await sharp(stub, { raw: { width, height, channels: 4 } }).png().toFile(abs);
      method = "template_composite_stub";
      completion_method = "neighbor_blend";
    }

    differentials.push({
      kind,
      path: rel,
      method,
      completion_method,
      prompt_hash,
      provenance: {
        prompt,
        prompt_hash,
        method,
        completion_method,
        dry_run: isDryRun() || Boolean(opts.dryRun) || completion_method !== "image_edit",
        ...(providerId ? { provider: providerId } : {}),
      },
    });
  }

  const reportPath = path.join(outDir, "expression_report.json");
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        version: "0.3",
        rule: "full_character_differential",
        differentials,
        note: "Prefer minRegionInpaint on feathered ROI mask (image_edit → opencv_inpaint → neighbor_blend). Dry-run seeds ROI morph then inpaint path.",
      },
      null,
      2
    )
  );

  return { differentials, reportPath };
}
