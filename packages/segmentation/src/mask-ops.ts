/**
 * Mask morphology + connected components for segmentation quality.
 * Operates on raw RGBA buffers (mask: white+alpha or alpha channel).
 */

export interface MaskStats {
  opaque_px: number;
  total_px: number;
  coverage: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

/** Read alpha as 0..255 mask strength (uses max(R,A) for white masks). */
export function alphaAt(buf: Buffer, i: number): number {
  const a = buf[i + 3] ?? 0;
  const r = buf[i] ?? 0;
  return Math.max(a, r);
}

export function maskCoverage(mask: Buffer, width: number, height: number, threshold = 8): MaskStats {
  let opaque = 0;
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  const total = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (alphaAt(mask, i) >= threshold) {
        opaque += 1;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return {
    opaque_px: opaque,
    total_px: total,
    coverage: total ? opaque / total : 0,
    bbox: opaque ? { x0, y0, x1, y1 } : undefined,
  };
}

/** Threshold alpha/white into binary mask (in-place or copy). */
export function thresholdMask(
  src: Buffer,
  width: number,
  height: number,
  threshold: number,
  out?: Buffer
): Buffer {
  const dst = out ?? Buffer.alloc(width * height * 4, 0);
  for (let i = 0; i < src.length; i += 4) {
    const on = alphaAt(src, i) >= threshold;
    dst[i] = on ? 255 : 0;
    dst[i + 1] = on ? 255 : 0;
    dst[i + 2] = on ? 255 : 0;
    dst[i + 3] = on ? 255 : 0;
  }
  return dst;
}

/**
 * Label connected components (4-connected) on binary mask.
 * Returns label id per pixel (0 = background) and sizes.
 */
export function connectedComponents(
  mask: Buffer,
  width: number,
  height: number,
  threshold = 8
): { labels: Int32Array; sizes: Map<number, number>; count: number } {
  const labels = new Int32Array(width * height);
  const sizes = new Map<number, number>();
  let next = 1;
  const stack: number[] = [];

  const idx = (x: number, y: number) => y * width + x;
  const on = (x: number, y: number) => {
    const i = idx(x, y) * 4;
    return alphaAt(mask, i) >= threshold;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = idx(x, y);
      if (labels[p] || !on(x, y)) continue;
      const id = next++;
      let size = 0;
      stack.push(p);
      labels[p] = id;
      while (stack.length) {
        const cur = stack.pop()!;
        size += 1;
        const cx = cur % width;
        const cy = (cur / width) | 0;
        const neigh = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = idx(nx, ny);
          if (labels[np] || !on(nx, ny)) continue;
          labels[np] = id;
          stack.push(np);
        }
      }
      sizes.set(id, size);
    }
  }
  return { labels, sizes, count: next - 1 };
}

/** Keep only the largest connected component; zero others. */
export function keepLargestComponent(
  mask: Buffer,
  width: number,
  height: number,
  threshold = 8
): Buffer {
  const { labels, sizes } = connectedComponents(mask, width, height, threshold);
  if (sizes.size === 0) return mask;
  let best = 0;
  let bestSize = 0;
  for (const [id, sz] of sizes) {
    if (sz > bestSize) {
      bestSize = sz;
      best = id;
    }
  }
  const out = Buffer.alloc(width * height * 4, 0);
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] !== best) continue;
    const i = p * 4;
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = 255;
  }
  return out;
}

/** Dilate binary mask by radius (Chebyshev / square kernel). */
export function dilate(
  mask: Buffer,
  width: number,
  height: number,
  radius: number,
  threshold = 8
): Buffer {
  if (radius <= 0) return Buffer.from(mask);
  const out = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = false;
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        for (let dx = -radius; dx <= radius && !hit; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const i = (ny * width + nx) * 4;
          if (alphaAt(mask, i) >= threshold) hit = true;
        }
      }
      if (hit) {
        const i = (y * width + x) * 4;
        out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 255;
      }
    }
  }
  return out;
}

/** Erode binary mask by radius. */
export function erode(
  mask: Buffer,
  width: number,
  height: number,
  radius: number,
  threshold = 8
): Buffer {
  if (radius <= 0) return Buffer.from(mask);
  const out = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let all = true;
      for (let dy = -radius; dy <= radius && all; dy++) {
        for (let dx = -radius; dx <= radius && all; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            all = false;
            break;
          }
          const i = (ny * width + nx) * 4;
          if (alphaAt(mask, i) < threshold) all = false;
        }
      }
      if (all) {
        const i = (y * width + x) * 4;
        out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 255;
      }
    }
  }
  return out;
}

/**
 * Feather edges: distance-based soft alpha within `radius` px of the hard mask boundary.
 * When radius=0, returns a hard copy.
 */
export function featherMask(
  mask: Buffer,
  width: number,
  height: number,
  radius: number,
  threshold = 8
): Buffer {
  if (radius <= 0) {
    return thresholdMask(mask, width, height, threshold);
  }
  // Close then soft falloff from dilated edge
  const hard = thresholdMask(mask, width, height, threshold);
  const out = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (alphaAt(hard, i) >= threshold) {
        out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 255;
        continue;
      }
      let minDist = radius + 1;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = (ny * width + nx) * 4;
          if (alphaAt(hard, ni) < threshold) continue;
          const d = Math.hypot(dx, dy);
          if (d < minDist) minDist = d;
        }
      }
      if (minDist <= radius) {
        const t = 1 - minDist / (radius + 1e-6);
        const a = Math.max(0, Math.min(255, Math.round(255 * t)));
        out[i] = out[i + 1] = out[i + 2] = a;
        out[i + 3] = a;
      }
    }
  }
  return out;
}

/** Morphological open/close helper: dilate then erode (close) or erode then dilate (open). */
export function morphClose(
  mask: Buffer,
  width: number,
  height: number,
  radius: number,
  threshold = 8
): Buffer {
  if (radius <= 0) return Buffer.from(mask);
  const d = dilate(mask, width, height, radius, threshold);
  return erode(d, width, height, radius, threshold);
}

export type BilateralSide = "LEFT" | "RIGHT";

const BILATERAL_SEMANTICS = /^(EYE|EYES|IRIS|PUPIL|BROW|ARM|HAND|EAR|SHOULDER|LEG|FOOT)/i;

export function isBilateralSemantic(semantic: string): boolean {
  return BILATERAL_SEMANTICS.test(semantic.trim());
}

/**
 * Find split column: prefer alpha valley near character center, else midpoint.
 */
export function findSplitColumn(
  mask: Buffer,
  width: number,
  height: number,
  threshold = 8
): number {
  const mid = Math.floor(width / 2);
  const colSum = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (alphaAt(mask, i) >= threshold) colSum[x] += 1;
    }
  }
  // Search valley in central 40% band
  const lo = Math.floor(width * 0.3);
  const hi = Math.ceil(width * 0.7);
  let bestX = mid;
  let bestVal = Number.POSITIVE_INFINITY;
  for (let x = lo; x <= hi; x++) {
    const v = colSum[x]!;
    // Prefer closer to mid when tied
    const score = v + Math.abs(x - mid) * 0.01;
    if (score < bestVal) {
      bestVal = score;
      bestX = x;
    }
  }
  return bestX;
}

/**
 * Keep only LEFT (character left = image left in our convention? Character LEFT is character's left.
 * In typical front-facing art, character's LEFT appears on the viewer's RIGHT.
 * Spec says LEFT/RIGHT = character's own left/right.
 * For mask split we use: LEFT side of character ≈ right half of image for front view.
 * Heuristic documented: character-center split — LEFT keeps x >= split (viewer's right),
 * RIGHT keeps x < split — matching mirrored character space for front-facing masters.
 *
 * Actually many pipelines treat canvas x=0 as left of image = character's right when facing camera.
 * Character LEFT (character's left hand) is on the right side of the image.
 * So: side LEFT → keep x >= splitColumn; side RIGHT → keep x < splitColumn.
 */
export function splitBySide(
  mask: Buffer,
  width: number,
  height: number,
  side: BilateralSide,
  splitColumn?: number,
  threshold = 8
): Buffer {
  const split = splitColumn ?? findSplitColumn(mask, width, height, threshold);
  const out = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (alphaAt(mask, i) < threshold) continue;
      const keep =
        side === "LEFT"
          ? x >= split // character left ≈ image right
          : x < split;
      if (!keep) continue;
      out[i] = mask[i]!;
      out[i + 1] = mask[i + 1]!;
      out[i + 2] = mask[i + 2]!;
      out[i + 3] = mask[i + 3]!;
    }
  }
  return out;
}
