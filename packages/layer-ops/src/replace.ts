/**
 * Human replace-and-continue: swap a layer PNG, update manifest + history,
 * so the operator can resume with compile / run.
 */
import { copyFile, mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { storeAsset, sha256Hex } from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";
import type { LayerManifest } from "@ai2live/domain";
import {
  loadHistoryStore,
  saveHistoryStore,
} from "@ai2live/history";

export interface ReplaceLayerResult {
  projectRoot: string;
  layerId: string;
  previous_asset_path?: string;
  asset_path: string;
  content_addressed_path?: string;
  sha256: string;
  history_head: string | null;
  manifest_path: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function replaceLayerPng(opts: {
  projectRoot: string;
  layerId: string;
  pngPath: string;
  /** Also copy into assets/sha256 (default true). */
  storeContentAddressed?: boolean;
  /** Relative destination under project (default layers/<layerId>.png or existing). */
  destRel?: string;
}): Promise<ReplaceLayerResult> {
  const root = path.resolve(opts.projectRoot);
  const pngAbs = path.resolve(opts.pngPath);
  if (!(await exists(pngAbs))) {
    throw new Error(`PNG not found: ${pngAbs}`);
  }

  const manifestPath = path.join(root, "spec", "layer_manifest.json");
  const manifest = assertLayerManifest(
    JSON.parse(await readFile(manifestPath, "utf8"))
  ) as LayerManifest;

  const layer = manifest.layers.find((l) => l.id === opts.layerId);
  if (!layer) {
    throw new Error(
      `Layer not found: ${opts.layerId}. Known: ${manifest.layers.map((l) => l.id).join(", ")}`
    );
  }

  const previous = layer.source.asset_path;
  const destRel =
    opts.destRel ??
    previous ??
    path.posix.join("layers", `${opts.layerId.replace(/^layer_/, "")}.png`);
  const destAbs = path.join(root, destRel);
  await mkdir(path.dirname(destAbs), { recursive: true });
  await copyFile(pngAbs, destAbs);

  const bytes = await readFile(destAbs);
  const hash = sha256Hex(bytes);
  let content_addressed_path: string | undefined;
  if (opts.storeContentAddressed !== false) {
    const stored = await storeAsset(root, bytes, ".png");
    content_addressed_path = stored.relativePath;
  }

  layer.source = {
    ...layer.source,
    type: layer.source.type || "user_asset",
    asset_path: destRel,
  };
  if (layer.status === "FAILED" || layer.status === "DRAFT") {
    layer.status = "READY";
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const history = await loadHistoryStore(root);
  let head = history.getHead();
  try {
    const node = history.append({
      expected_head: head,
      action: "replace_layer_asset",
      target: opts.layerId,
      message: `replace ${opts.layerId} ← ${path.basename(pngAbs)}`,
      asset_hashes: { [opts.layerId]: hash },
      payload: {
        previous_asset_path: previous,
        asset_path: destRel,
        content_addressed_path,
        png_source: pngAbs,
      },
      seed: `replace-${opts.layerId}-${hash.slice(0, 12)}`,
    });
    head = node.id;
    await saveHistoryStore(root, history);
  } catch {
    /* history optional if stale — still succeed replace */
  }

  return {
    projectRoot: root,
    layerId: opts.layerId,
    previous_asset_path: previous,
    asset_path: destRel,
    content_addressed_path,
    sha256: hash,
    history_head: head,
    manifest_path: manifestPath,
  };
}
