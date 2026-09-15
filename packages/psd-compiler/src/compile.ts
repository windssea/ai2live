import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { writePsd } from "ag-psd";
import {
  shortId,
  formatLayerPsdName,
  defaultGroupForSemantic,
  PSD_GROUP_ORDER,
  storeAsset,
  type LayerManifest,
  type LayerNode,
} from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";
import { loadLayerRgba, layersByZDesc, recomposeNeutral } from "./compose.js";
import {
  expectedFromImportLayers,
  validatePsdRoundtrip,
  type PsdRoundtripReport,
} from "./roundtrip.js";

export interface CompileOptions {
  projectRoot: string;
  manifestPath?: string;
  outDir?: string;
  /** Skip Gate 6 PSD read-back (default false). */
  skipRoundtrip?: boolean;
  /** Hash layer PNGs into assets/sha256/... (default true). */
  storeContentAddressed?: boolean;
}

export interface ImportManifestLayer {
  id: string;
  uuid: string;
  psd_name: string;
  semantic: string;
  side: string;
  z_index: number;
  group: string;
  asset_path?: string;
  /** Content-addressed sha256 of layer PNG bytes when store is wired. */
  sha256?: string;
  content_addressed_path?: string;
}

export interface CompileResult {
  psdPath: string;
  importManifestPath: string;
  recomposedPath: string;
  importManifest: {
    version: "0.1";
    character_id: string;
    canvas: { width: number; height: number };
    layers: ImportManifestLayer[];
    notes: string;
    asset_store?: {
      scheme: "sha256";
      root: "assets/sha256";
      layer_count_hashed: number;
    };
  };
  roundtrip?: PsdRoundtripReport;
}

function groupName(layer: LayerNode): string {
  return layer.group ?? defaultGroupForSemantic(layer.semantic);
}

export async function compilePsd(options: CompileOptions): Promise<CompileResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const manifestPath =
    options.manifestPath ?? path.join(projectRoot, "spec", "layer_manifest.json");
  const outDir = options.outDir ?? projectRoot;
  const storeCA = options.storeContentAddressed !== false;

  const raw = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = assertLayerManifest(raw) as LayerManifest;
  const { width, height } = manifest.canvas;

  const loaded = new Map<string, Awaited<ReturnType<typeof loadLayerRgba>>>();
  for (const layer of manifest.layers) {
    loaded.set(layer.id, await loadLayerRgba(projectRoot, manifest, layer));
  }

  const byGroup = new Map<string, LayerNode[]>();
  for (const layer of manifest.layers) {
    const g = groupName(layer);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(layer);
  }

  const orderedGroups = [
    ...PSD_GROUP_ORDER.filter((g) => byGroup.has(g)),
    ...[...byGroup.keys()].filter((g) => !(PSD_GROUP_ORDER as readonly string[]).includes(g)),
  ];

  const importLayers: ImportManifestLayer[] = [];
  const children: object[] = [];
  let hashed = 0;

  // ag-psd: children[0] is top-most
  for (const gName of orderedGroups) {
    const groupLayers = layersByZDesc(byGroup.get(gName)!);
    const groupChildren: object[] = [];
    for (const layer of groupLayers) {
      const L = loaded.get(layer.id)!;
      const psdName = formatLayerPsdName(layer, shortId(layer.id));
      groupChildren.push({
        name: psdName,
        opacity: 1,
        blendMode: "normal",
        imageData: {
          width,
          height,
          data: new Uint8ClampedArray(L.rgba),
        },
      });

      const entry: ImportManifestLayer = {
        id: layer.id,
        uuid: layer.id,
        psd_name: psdName,
        semantic: layer.semantic,
        side: layer.side,
        z_index: layer.z_index,
        group: gName,
        asset_path: layer.source.asset_path,
      };

      if (storeCA && layer.source.asset_path) {
        const abs = path.isAbsolute(layer.source.asset_path)
          ? layer.source.asset_path
          : path.join(projectRoot, layer.source.asset_path);
        try {
          const bytes = await readFile(abs);
          const stored = await storeAsset(projectRoot, bytes, ".png");
          entry.sha256 = stored.hash;
          entry.content_addressed_path = stored.relativePath;
          hashed += 1;
        } catch {
          /* missing asset — QC will flag; skip hash */
        }
      }

      importLayers.push(entry);
    }
    children.push({
      name: `[${gName}]`,
      opened: true,
      children: groupChildren,
    });
  }

  const psdDoc = {
    width,
    height,
    channels: 3,
    bitsPerChannel: 8,
    colorMode: 3,
    children,
  };

  const arrayBuffer = writePsd(psdDoc as Parameters<typeof writePsd>[0], {
    invalidateTextLayers: true,
    noBackground: true,
  });

  const psdDir = path.join(outDir, "psd");
  const previewDir = path.join(outDir, "previews");
  await mkdir(psdDir, { recursive: true });
  await mkdir(previewDir, { recursive: true });

  const psdPath = path.join(psdDir, "character.psd");
  await writeFile(psdPath, Buffer.from(arrayBuffer));

  const importManifest = {
    version: "0.1" as const,
    character_id: manifest.character_id,
    canvas: { width, height },
    layers: importLayers,
    notes:
      "LEFT/RIGHT are character-own sides. UUIDs preserved; PSD names use short-id suffix. sha256 fields reference assets/sha256/ when content-addressed store is wired.",
    ...(storeCA
      ? {
          asset_store: {
            scheme: "sha256" as const,
            root: "assets/sha256" as const,
            layer_count_hashed: hashed,
          },
        }
      : {}),
  };
  const importManifestPath = path.join(psdDir, "import_manifest.json");
  await writeFile(importManifestPath, JSON.stringify(importManifest, null, 2));

  const recomposed = await recomposeNeutral(projectRoot, manifest);
  const recomposedPath = path.join(previewDir, "recomposed_neutral.png");
  await writeFile(recomposedPath, recomposed.png);

  let roundtrip: PsdRoundtripReport | undefined;
  if (!options.skipRoundtrip) {
    const boundsByName = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const layer of manifest.layers) {
      if (!layer.canvas_bounds) continue;
      const psdName = formatLayerPsdName(layer, shortId(layer.id));
      boundsByName.set(psdName, layer.canvas_bounds);
    }
    roundtrip = await validatePsdRoundtrip({
      projectRoot,
      psdPath,
      expectedLayers: expectedFromImportLayers(importLayers, boundsByName),
      canvas: { width, height },
    });
  }

  return { psdPath, importManifestPath, recomposedPath, importManifest, roundtrip };
}
