import { describe, it, expect } from "vitest";
import {
  thresholdMask,
  connectedComponents,
  keepLargestComponent,
  dilate,
  erode,
  featherMask,
  findSplitColumn,
  splitBySide,
  maskCoverage,
  isBilateralSemantic,
} from "./mask-ops.js";

function blank(w: number, h: number): Buffer {
  return Buffer.alloc(w * h * 4, 0);
}

function setPx(buf: Buffer, w: number, x: number, y: number, v = 255) {
  const i = (y * w + x) * 4;
  buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = v;
}

describe("mask-ops", () => {
  it("thresholds and counts coverage", () => {
    const w = 8;
    const h = 8;
    const m = blank(w, h);
    setPx(m, w, 2, 2, 200);
    setPx(m, w, 3, 2, 4); // below default threshold after thresholdMask with 8
    const t = thresholdMask(m, w, h, 8);
    const stats = maskCoverage(t, w, h, 8);
    expect(stats.opaque_px).toBe(1);
    expect(stats.coverage).toBeCloseTo(1 / 64);
  });

  it("keeps largest connected component", () => {
    const w = 10;
    const h = 10;
    const m = blank(w, h);
    // small blob
    setPx(m, w, 1, 1);
    // large blob
    for (let y = 5; y < 9; y++) for (let x = 5; x < 9; x++) setPx(m, w, x, y);
    const kept = keepLargestComponent(m, w, h);
    const { sizes } = connectedComponents(kept, w, h);
    expect(sizes.size).toBe(1);
    expect([...sizes.values()][0]).toBe(16);
  });

  it("dilate then erode roughly restores (morph close expands holes less)", () => {
    const w = 16;
    const h = 16;
    const m = blank(w, h);
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) setPx(m, w, x, y);
    const d = dilate(m, w, h, 1);
    expect(maskCoverage(d, w, h).opaque_px).toBeGreaterThan(maskCoverage(m, w, h).opaque_px);
    const e = erode(d, w, h, 1);
    expect(maskCoverage(e, w, h).opaque_px).toBeGreaterThanOrEqual(64);
  });

  it("feather softens edge", () => {
    const w = 16;
    const h = 16;
    const m = blank(w, h);
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) setPx(m, w, x, y);
    const f = featherMask(m, w, h, 2);
    // Outside hard mask but within feather radius should have partial alpha
    const i = (3 * w + 7) * 4; // just above the block
    expect(f[i + 3]!).toBeGreaterThan(0);
    expect(f[i + 3]!).toBeLessThan(255);
  });

  it("bilateral split uses valley / midpoint", () => {
    expect(isBilateralSemantic("EYE")).toBe(true);
    expect(isBilateralSemantic("BODY")).toBe(false);
    const w = 20;
    const h = 10;
    const m = blank(w, h);
    // two blobs left and right with gap at center
    for (let y = 2; y < 8; y++) {
      for (let x = 1; x < 6; x++) setPx(m, w, x, y);
      for (let x = 14; x < 19; x++) setPx(m, w, x, y);
    }
    const split = findSplitColumn(m, w, h);
    expect(split).toBeGreaterThan(6);
    expect(split).toBeLessThan(14);
    const left = splitBySide(m, w, h, "LEFT", split);
    const right = splitBySide(m, w, h, "RIGHT", split);
    // character LEFT = image right half
    expect(maskCoverage(left, w, h).opaque_px).toBeGreaterThan(0);
    expect(maskCoverage(right, w, h).opaque_px).toBeGreaterThan(0);
    // disjoint
    for (let i = 0; i < left.length; i += 4) {
      const la = left[i + 3]!;
      const ra = right[i + 3]!;
      expect(la > 0 && ra > 0).toBe(false);
    }
  });
});
