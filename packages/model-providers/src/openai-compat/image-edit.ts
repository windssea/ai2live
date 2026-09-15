/**
 * Shared OpenAI-compatible Images API helper + dry-run file writer.
 *
 * Live path: POST {baseUrl}/images/edits (multipart) when an API key is set.
 * Dry-run: copy input PNG (or write a tiny transparent PNG) under project previews/.
 *
 * Grok/xAI may not expose /images/edits; callers can fall back to dry-run or
 * document chat+vision as a future path (see method: chat_vision_fallback).
 */
import { mkdir, copyFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { isDryRun } from "../env.js";
import type { ImageEditRequest, ImageEditResult, ProviderId } from "../types.js";

/** 1x1 transparent PNG */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

export function resolveImageOutputPath(req: ImageEditRequest): string {
  if (req.outputPath) return path.resolve(req.outputPath);
  const root = req.projectRoot ? path.resolve(req.projectRoot) : process.cwd();
  const stamp = Date.now();
  return path.join(root, "previews", `image_edit_${stamp}.png`);
}

export async function dryRunImageEdit(req: ImageEditRequest): Promise<ImageEditResult> {
  const outputPath = resolveImageOutputPath(req);
  await mkdir(path.dirname(outputPath), { recursive: true });

  if (req.inputImagePath) {
    try {
      await access(req.inputImagePath);
      await copyFile(req.inputImagePath, outputPath);
      return { outputPath, dryRun: true, method: "dry_run_copy" };
    } catch {
      /* fall through to tiny png */
    }
  }
  await writeFile(outputPath, TINY_PNG);
  return { outputPath, dryRun: true, method: "dry_run_png" };
}

export interface OpenAIImagesEditConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  provider: ProviderId;
  fetchImpl?: typeof fetch;
}

/**
 * Call OpenAI-compatible Images edits endpoint.
 * Body is multipart/form-data: image, prompt, optional mask/model.
 */
export async function openAICompatImageEdit(
  cfg: OpenAIImagesEditConfig,
  req: ImageEditRequest
): Promise<ImageEditResult> {
  if (isDryRun()) {
    return dryRunImageEdit(req);
  }

  const fetchFn = cfg.fetchImpl ?? req.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error("fetch is not available in this runtime");
  }
  if (!req.inputImagePath) {
    throw new Error("imageEdit requires inputImagePath for live Images API calls");
  }

  const { readFile } = await import("node:fs/promises");
  const imageBytes = await readFile(req.inputImagePath);
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(imageBytes)], { type: "image/png" }), path.basename(req.inputImagePath));
  form.append("prompt", req.prompt);
  form.append("model", req.model ?? cfg.defaultModel);
  form.append("response_format", "b64_json");
  if (req.maskPath) {
    const maskBytes = await readFile(req.maskPath);
    form.append("mask", new Blob([new Uint8Array(maskBytes)], { type: "image/png" }), path.basename(req.maskPath));
  }

  const url = `${cfg.baseUrl}/images/edits`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Images API edit failed (${res.status} ${res.statusText}) at ${url}: ${body.slice(0, 500)}`
    );
  }

  const raw = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const b64 = raw.data?.[0]?.b64_json;
  const outputPath = resolveImageOutputPath(req);
  await mkdir(path.dirname(outputPath), { recursive: true });

  if (b64) {
    await writeFile(outputPath, Buffer.from(b64, "base64"));
  } else if (raw.data?.[0]?.url) {
    // URL response — download if possible
    const imgRes = await fetchFn(raw.data[0].url);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    await writeFile(outputPath, buf);
  } else {
    throw new Error("Images API response missing b64_json/url");
  }

  return { outputPath, method: "images_api", raw };
}
