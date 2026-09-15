import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replaceLayerPng } from "./replace.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EXAMPLE = path.join(REPO, "examples/simple-character");

describe("replaceLayerPng", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-layer-replace-"));
    // minimal project from example manifest + one layer png
    await mkdir(path.join(dir, "spec"), { recursive: true });
    await mkdir(path.join(dir, "layers"), { recursive: true });
    const man = JSON.parse(
      await readFile(path.join(EXAMPLE, "spec", "layer_manifest.json"), "utf8")
    );
    await writeFile(path.join(dir, "spec", "layer_manifest.json"), JSON.stringify(man, null, 2));
    // copy first layer asset if present
    const first = man.layers[0];
    if (first?.source?.asset_path) {
      const src = path.join(EXAMPLE, first.source.asset_path);
      try {
        await mkdir(path.dirname(path.join(dir, first.source.asset_path)), { recursive: true });
        await copyFile(src, path.join(dir, first.source.asset_path));
      } catch {
        // write tiny PNG header-ish placeholder via raw bytes later
        await writeFile(path.join(dir, first.source.asset_path), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      }
    }
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("replaces layer PNG, updates manifest, records history", async () => {
    const man = JSON.parse(
      await readFile(path.join(dir, "spec", "layer_manifest.json"), "utf8")
    );
    const layerId = man.layers[0].id as string;
    const png = path.join(dir, "replacement.png");
    // valid minimal 1x1 PNG
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    await writeFile(png, pngBytes);

    const result = await replaceLayerPng({
      projectRoot: dir,
      layerId,
      pngPath: png,
    });

    expect(result.layerId).toBe(layerId);
    expect(result.sha256).toHaveLength(64);
    expect(result.asset_path).toBeTruthy();
    const updated = JSON.parse(
      await readFile(path.join(dir, "spec", "layer_manifest.json"), "utf8")
    );
    const layer = updated.layers.find((l: { id: string }) => l.id === layerId);
    expect(layer.source.asset_path).toBe(result.asset_path);
    const hist = JSON.parse(await readFile(path.join(dir, "validation", "history.json"), "utf8"));
    expect(hist.nodes.some((n: { action: string }) => n.action === "replace_layer_asset")).toBe(
      true
    );
  });

  it("throws on unknown layer", async () => {
    const png = path.join(dir, "x.png");
    await writeFile(png, Buffer.from("x"));
    await expect(
      replaceLayerPng({ projectRoot: dir, layerId: "nope", pngPath: png })
    ).rejects.toThrow(/not found/i);
  });
});
