import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { readPsd } from "ag-psd";
import { createStableId, type ValidationFinding } from "@ai2live/domain";
import type { ImportManifestLayer } from "./compile.js";

export interface ExpectedLayerRef {
  psd_name: string;
  z_index: number;
  group: string;
  /** Optional expected canvas-normalized bounds; compared roughly when present. */
  bounds?: { x: number; y: number; w: number; h: number };
}

export interface PsdRoundtripLayer {
  name: string;
  /** Depth-first leaf order within groups (top→bottom as in PSD children). */
  order: number;
  group?: string;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export interface PsdRoundtripReport {
  version: "0.1";
  gate: "GATE_6_PSD_ROUNDTRIP";
  passed: boolean;
  psd_path: string;
  expected_leaf_count: number;
  read_leaf_count: number;
  expected_names: string[];
  read_names: string[];
  missing_names: string[];
  unexpected_names: string[];
  /** Names present in both but in different relative z-order. */
  z_order_mismatches: string[];
  bounds_mismatches: Array<{ name: string; detail: string }>;
  findings: ValidationFinding[];
  note: string;
}

interface FlatLayer {
  name: string;
  group?: string;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

function flattenLeaves(
  children: Array<{ name?: string; children?: unknown[]; left?: number; top?: number; right?: number; bottom?: number }> | undefined,
  group?: string
): FlatLayer[] {
  if (!children?.length) return [];
  const out: FlatLayer[] = [];
  for (const node of children) {
    const name = node.name ?? "";
    if (node.children && Array.isArray(node.children)) {
      const g =
        name.startsWith("[") && name.endsWith("]")
          ? name.slice(1, -1)
          : group;
      out.push(...flattenLeaves(node.children as typeof children, g));
    } else {
      out.push({
        name,
        group,
        left: node.left,
        top: node.top,
        right: node.right,
        bottom: node.bottom,
      });
    }
  }
  return out;
}

/**
 * Gate 6: read back a written PSD and compare structural fields.
 * Structural only (names / count / z-order / rough bounds) — not pixel flatten compare.
 * Uses skipLayerImageData so Node does not need node-canvas.
 */
export async function validatePsdRoundtrip(opts: {
  projectRoot: string;
  psdPath: string;
  expectedLayers: ExpectedLayerRef[];
  canvas?: { width: number; height: number };
  /** Write validation/psd_roundtrip.json (default true). */
  writeReport?: boolean;
}): Promise<PsdRoundtripReport> {
  const root = path.resolve(opts.projectRoot);
  const psdAbs = path.resolve(opts.psdPath);
  const buf = await readFile(psdAbs);

  const psd = readPsd(buf, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
    useImageData: true,
  });

  const readLeaves = flattenLeaves(psd.children as Parameters<typeof flattenLeaves>[0]);
  const expectedNames = opts.expectedLayers.map((l) => l.psd_name);
  const readNames = readLeaves.map((l) => l.name);

  const expectedSet = new Set(expectedNames);
  const readSet = new Set(readNames);
  const missing_names = expectedNames.filter((n) => !readSet.has(n));
  const unexpected_names = readNames.filter((n) => !expectedSet.has(n));

  // Compare relative order among shared names (PSD children[0] = top-most).
  const sharedExpected = expectedNames.filter((n) => readSet.has(n));
  const sharedRead = readNames.filter((n) => expectedSet.has(n));
  const z_order_mismatches: string[] = [];
  for (let i = 0; i < Math.min(sharedExpected.length, sharedRead.length); i++) {
    if (sharedExpected[i] !== sharedRead[i]) {
      z_order_mismatches.push(
        `at rank ${i}: expected ${sharedExpected[i]}, read ${sharedRead[i]}`
      );
    }
  }

  const bounds_mismatches: Array<{ name: string; detail: string }> = [];
  const canvas = opts.canvas;
  if (canvas) {
    for (const exp of opts.expectedLayers) {
      if (!exp.bounds) continue;
      const leaf = readLeaves.find((l) => l.name === exp.psd_name);
      if (!leaf) continue;
      const lw = (leaf.right ?? 0) - (leaf.left ?? 0);
      const lh = (leaf.bottom ?? 0) - (leaf.top ?? 0);
      // Full-canvas layers often round-trip as 0,0,W,H; accept that as OK.
      const isFull =
        (leaf.left ?? 0) <= 1 &&
        (leaf.top ?? 0) <= 1 &&
        Math.abs(lw - canvas.width) <= 2 &&
        Math.abs(lh - canvas.height) <= 2;
      if (isFull) continue;
      // Rough normalized compare when partial bounds exist
      const nx = (leaf.left ?? 0) / canvas.width;
      const ny = (leaf.top ?? 0) / canvas.height;
      const nw = lw / canvas.width;
      const nh = lh / canvas.height;
      const dx = Math.abs(nx - exp.bounds.x);
      const dy = Math.abs(ny - exp.bounds.y);
      const dw = Math.abs(nw - exp.bounds.w);
      const dh = Math.abs(nh - exp.bounds.h);
      if (dx > 0.08 || dy > 0.08 || dw > 0.12 || dh > 0.12) {
        bounds_mismatches.push({
          name: exp.psd_name,
          detail: `expected≈(${exp.bounds.x.toFixed(2)},${exp.bounds.y.toFixed(2)},${exp.bounds.w.toFixed(2)},${exp.bounds.h.toFixed(2)}) read≈(${nx.toFixed(2)},${ny.toFixed(2)},${nw.toFixed(2)},${nh.toFixed(2)})`,
        });
      }
    }
  }

  const findings: ValidationFinding[] = [];
  const structuralLoss =
    missing_names.length > 0 ||
    unexpected_names.length > 0 ||
    readLeaves.length !== opts.expectedLayers.length ||
    z_order_mismatches.length > 0;

  if (structuralLoss) {
    findings.push({
      id: createStableId("finding", `psd-rt-${path.basename(psdAbs)}`),
      severity: "ERROR",
      type: "PSD_ROUNDTRIP_STRUCTURAL_LOSS",
      message: `PSD round-trip structural mismatch: missing=${missing_names.length} unexpected=${unexpected_names.length} z_order=${z_order_mismatches.length} count_expected=${opts.expectedLayers.length} count_read=${readLeaves.length}`,
      hypothesis: "writePsd→readPsd lost layer names, count, or z-order",
      recommended_action: "Inspect psd/character.psd groups and import_manifest layer list",
    });
  } else {
    findings.push({
      id: createStableId("finding", `psd-rt-ok-${path.basename(psdAbs)}`),
      severity: "INFO",
      type: "PSD_ROUNDTRIP_OK",
      message: `PSD round-trip OK: ${readLeaves.length} leaf layers, names/z-order preserved`,
    });
  }

  if (bounds_mismatches.length > 0) {
    findings.push({
      id: createStableId("finding", `psd-rt-bounds-${path.basename(psdAbs)}`),
      severity: "WARNING",
      type: "PSD_ROUNDTRIP_BOUNDS_DRIFT",
      message: `Rough bounds drift on ${bounds_mismatches.length} layer(s) (heuristic; full-canvas layers are exempt)`,
    });
  }

  const passed = !findings.some((f) => f.severity === "ERROR");
  const report: PsdRoundtripReport = {
    version: "0.1",
    gate: "GATE_6_PSD_ROUNDTRIP",
    passed,
    psd_path: path.relative(root, psdAbs),
    expected_leaf_count: opts.expectedLayers.length,
    read_leaf_count: readLeaves.length,
    expected_names: expectedNames,
    read_names: readNames,
    missing_names,
    unexpected_names,
    z_order_mismatches,
    bounds_mismatches,
    findings,
    note: "Gate 6 structural round-trip (names/count/z-order/rough bounds). Pixel flatten fidelity is Gate 3 / static QC.",
  };

  if (opts.writeReport !== false) {
    const outDir = path.join(root, "validation");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "psd_roundtrip.json"), JSON.stringify(report, null, 2));
  }

  return report;
}

/** Map compile import_manifest layers → expected refs (already top→bottom within groups). */
export function expectedFromImportLayers(
  layers: ImportManifestLayer[],
  boundsByName?: Map<string, { x: number; y: number; w: number; h: number }>
): ExpectedLayerRef[] {
  return layers.map((l) => ({
    psd_name: l.psd_name,
    z_index: l.z_index,
    group: l.group,
    ...(boundsByName?.get(l.psd_name)
      ? { bounds: boundsByName.get(l.psd_name) }
      : {}),
  }));
}
