/**
 * A/B metric helper: see-through (masked hole) vs completion (inpainted).
 * Used to decide whether completion improved the region vs leaving a hole / raw see-through.
 */
import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface AbMetricSample {
  label: string;
  /** Original/composite with hole or see-through (alpha low in mask). */
  seeThroughPath: string;
  /** Completed / inpainted image. */
  completionPath: string;
  /** Mask of region under evaluation (opaque = region). */
  maskPath: string;
}

export interface AbRegionMetrics {
  label: string;
  mask_pixels: number;
  /** Mean alpha in see-through under mask (lower = more hole). */
  see_through_mean_alpha: number;
  /** Mean alpha in completion under mask. */
  completion_mean_alpha: number;
  /** Mean |ΔRGB| between see-through and completion under mask (opaque samples). */
  mean_abs_rgb_delta: number;
  /** Fraction of mask pixels that gained alpha (>=128) after completion. */
  alpha_recovery_rate: number;
  /** Heuristic score in [0,1]: higher = completion looks more filled / coherent. */
  completion_score: number;
  /** Prefer completion when score improves vs see-through baseline. */
  prefer_completion: boolean;
  note?: string;
}

export interface AbCompareResult {
  version: "0.1";
  samples: AbRegionMetrics[];
  mean_completion_score: number;
  prefer_completion_count: number;
  timestamp: string;
}

async function loadRgba(p: string, w: number, h: number): Promise<Buffer> {
  return sharp(p).ensureAlpha().resize(w, h, { fit: "fill" }).raw().toBuffer();
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Compare see-through vs completion under a mask.
 */
export async function compareSeeThroughVsCompletion(
  sample: AbMetricSample
): Promise<AbRegionMetrics> {
  const meta = await sharp(sample.completionPath).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) {
    return {
      label: sample.label,
      mask_pixels: 0,
      see_through_mean_alpha: 0,
      completion_mean_alpha: 0,
      mean_abs_rgb_delta: 0,
      alpha_recovery_rate: 0,
      completion_score: 0,
      prefer_completion: false,
      note: "invalid dimensions",
    };
  }
  const [see, done, mask] = await Promise.all([
    loadRgba(sample.seeThroughPath, w, h),
    loadRgba(sample.completionPath, w, h),
    loadRgba(sample.maskPath, w, h),
  ]);

  let maskPixels = 0;
  let recovered = 0;
  const seeA: number[] = [];
  const doneA: number[] = [];
  const deltas: number[] = [];

  for (let i = 0; i < w * h; i++) {
    const mi = i * 4;
    if (mask[mi + 3]! < 128) continue;
    maskPixels++;
    const sa = see[mi + 3]!;
    const da = done[mi + 3]!;
    seeA.push(sa);
    doneA.push(da);
    if (sa < 128 && da >= 128) recovered++;
    if (da >= 128) {
      deltas.push(
        (Math.abs(see[mi]! - done[mi]!) +
          Math.abs(see[mi + 1]! - done[mi + 1]!) +
          Math.abs(see[mi + 2]! - done[mi + 2]!)) /
          3
      );
    }
  }

  const see_through_mean_alpha = mean(seeA) / 255;
  const completion_mean_alpha = mean(doneA) / 255;
  const mean_abs_rgb_delta = mean(deltas) / 255;
  const alpha_recovery_rate = maskPixels ? recovered / maskPixels : 0;

  // Score: reward alpha recovery + high completion alpha; mild penalty for huge RGB churn
  // (huge churn can mean identity drift — keep small weight).
  const completion_score = Math.max(
    0,
    Math.min(
      1,
      0.55 * alpha_recovery_rate +
        0.35 * completion_mean_alpha +
        0.1 * (1 - Math.min(1, mean_abs_rgb_delta))
    )
  );
  const seeScore = Math.max(0, Math.min(1, 0.5 * see_through_mean_alpha));
  const prefer_completion = completion_score >= seeScore + 0.08 || alpha_recovery_rate >= 0.25;

  return {
    label: sample.label,
    mask_pixels: maskPixels,
    see_through_mean_alpha,
    completion_mean_alpha,
    mean_abs_rgb_delta,
    alpha_recovery_rate,
    completion_score,
    prefer_completion,
  };
}

export async function runAbCompare(
  samples: AbMetricSample[],
  opts?: { writeReportPath?: string }
): Promise<AbCompareResult> {
  const metrics: AbRegionMetrics[] = [];
  for (const s of samples) {
    metrics.push(await compareSeeThroughVsCompletion(s));
  }
  const mean_completion_score = mean(metrics.map((m) => m.completion_score));
  const result: AbCompareResult = {
    version: "0.1",
    samples: metrics,
    mean_completion_score,
    prefer_completion_count: metrics.filter((m) => m.prefer_completion).length,
    timestamp: new Date().toISOString(),
  };
  if (opts?.writeReportPath) {
    await mkdir(path.dirname(opts.writeReportPath), { recursive: true });
    await writeFile(opts.writeReportPath, JSON.stringify(result, null, 2) + "\n");
  }
  return result;
}
