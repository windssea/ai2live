import { describe, it, expect, beforeAll } from "vitest";
import { mkdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePsd } from "./compile.js";
import { validatePsdRoundtrip, expectedFromImportLayers } from "./roundtrip.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const example = path.join(repoRoot, "examples/simple-character");

async function ensureExampleAssets() {
  try {
    await access(path.join(example, "layers/face.png"));
  } catch {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("node", [path.join(example, "generate-assets.mjs")], {
      cwd: example,
    });
  }
}

describe("Gate 6 PSD round-trip", () => {
  beforeAll(async () => {
    await ensureExampleAssets();
  }, 60_000);

  it("compile writes validation/psd_roundtrip.json and passes structural checks", async () => {
    const result = await compilePsd({ projectRoot: example });
    expect(result.roundtrip).toBeTruthy();
    expect(result.roundtrip!.passed).toBe(true);
    expect(result.roundtrip!.read_leaf_count).toBe(result.importManifest.layers.length);
    expect(result.roundtrip!.missing_names).toEqual([]);

    const report = JSON.parse(
      await readFile(path.join(example, "validation/psd_roundtrip.json"), "utf8")
    );
    expect(report.gate).toBe("GATE_6_PSD_ROUNDTRIP");
    expect(report.passed).toBe(true);

    // Content-addressed store wired
    expect(result.importManifest.asset_store?.scheme).toBe("sha256");
    expect(result.importManifest.layers.some((l) => l.sha256)).toBe(true);
    const hashed = result.importManifest.layers.find((l) => l.content_addressed_path);
    expect(hashed?.content_addressed_path).toMatch(/^assets\/sha256\//);
  }, 60_000);

  it("validatePsdRoundtrip detects missing layer names", async () => {
    const compiled = await compilePsd({ projectRoot: example, skipRoundtrip: true });
    const bad = expectedFromImportLayers(compiled.importManifest.layers).map((l, i) =>
      i === 0 ? { ...l, psd_name: "TOTALLY_MISSING_LAYER" } : l
    );
    const report = await validatePsdRoundtrip({
      projectRoot: example,
      psdPath: compiled.psdPath,
      expectedLayers: bad,
      canvas: compiled.importManifest.canvas,
      writeReport: false,
    });
    expect(report.passed).toBe(false);
    expect(report.missing_names).toContain("TOTALLY_MISSING_LAYER");
    expect(report.findings.some((f) => f.severity === "ERROR")).toBe(true);
  }, 60_000);
});
