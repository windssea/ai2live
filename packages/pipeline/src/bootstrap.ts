/**
 * Bootstrap a project from a single character design / reference image.
 * Prefer LLM layer plan when provider is live; fall back to deterministic anime template.
 */
import sharp from "sharp";
import { mkdir, copyFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createStableId, defaultGroupForSemantic, type LayerManifest, type CharacterSpec, type LayerNode, type OcclusionEdge } from "@ai2live/domain";
import {
  createProvider,
  resolveProviderId,
  isDryRun,
  type ProviderId,
} from "@ai2live/model-providers";

export interface BootstrapFromImageOptions {
  projectRoot: string;
  imagePath: string;
  characterName?: string;
  provider?: string;
  dryRun?: boolean;
}

export interface BootstrapResult {
  projectRoot: string;
  characterPath: string;
  manifestPath: string;
  masterPath: string;
  referencePath: string;
  method: "llm" | "template";
  canvas: { width: number; height: number };
}

interface TemplateLayerDef {
  key: string;
  display_name: string;
  semantic: string;
  side: "LEFT" | "RIGHT" | "CENTER";
  z_index: number;
  bounds: { x: number; y: number; w: number; h: number };
  asset_file: string;
}

/** Deterministic anime upper-body layer plan (normalized canvas bounds). */
export const ANIME_UPPER_BODY_TEMPLATE: TemplateLayerDef[] = [
  { key: "back_hair", display_name: "back_hair", semantic: "BACK_HAIR", side: "CENTER", z_index: 10, bounds: { x: 0.22, y: 0.05, w: 0.56, h: 0.58 }, asset_file: "back_hair.png" },
  { key: "body", display_name: "body", semantic: "BODY", side: "CENTER", z_index: 20, bounds: { x: 0.28, y: 0.42, w: 0.44, h: 0.52 }, asset_file: "body.png" },
  { key: "arm_l", display_name: "arm_left", semantic: "ARM", side: "LEFT", z_index: 25, bounds: { x: 0.12, y: 0.45, w: 0.22, h: 0.4 }, asset_file: "arm_l.png" },
  { key: "arm_r", display_name: "arm_right", semantic: "ARM", side: "RIGHT", z_index: 25, bounds: { x: 0.66, y: 0.45, w: 0.22, h: 0.4 }, asset_file: "arm_r.png" },
  { key: "face", display_name: "face", semantic: "FACE", side: "CENTER", z_index: 40, bounds: { x: 0.3, y: 0.1, w: 0.4, h: 0.38 }, asset_file: "face.png" },
  { key: "eye_l", display_name: "eye_left", semantic: "EYE", side: "LEFT", z_index: 50, bounds: { x: 0.34, y: 0.22, w: 0.12, h: 0.09 }, asset_file: "eye_l.png" },
  { key: "eye_r", display_name: "eye_right", semantic: "EYE", side: "RIGHT", z_index: 50, bounds: { x: 0.54, y: 0.22, w: 0.12, h: 0.09 }, asset_file: "eye_r.png" },
  { key: "mouth", display_name: "mouth", semantic: "MOUTH", side: "CENTER", z_index: 55, bounds: { x: 0.42, y: 0.36, w: 0.16, h: 0.07 }, asset_file: "mouth.png" },
  { key: "front_hair", display_name: "front_hair", semantic: "FRONT_HAIR", side: "CENTER", z_index: 70, bounds: { x: 0.26, y: 0.04, w: 0.48, h: 0.3 }, asset_file: "front_hair.png" },
];

function buildLayersFromTemplate(
  characterId: string,
  seed: string
): { layers: LayerNode[]; edges: OcclusionEdge[]; byKey: Record<string, string> } {
  const byKey: Record<string, string> = {};
  const layers: LayerNode[] = ANIME_UPPER_BODY_TEMPLATE.map((t) => {
    const id = createStableId("layer", `${seed}:${t.key}`);
    byKey[t.key] = id;
    return {
      id,
      display_name: t.display_name,
      semantic: t.semantic,
      side: t.side,
      index: 1,
      z_index: t.z_index,
      group: defaultGroupForSemantic(t.semantic),
      canvas_bounds: { ...t.bounds },
      source: {
        type: "master_pixels",
        master_asset_id: "asset_master_neutral",
        asset_path: `layers/${t.asset_file}`,
      },
      status: "DRAFT" as const,
    };
  });

  const edges: OcclusionEdge[] = [
    {
      id: "occ_bang_face",
      occluder: byKey.front_hair!,
      occludee: byKey.face!,
      notes: "Bangs over forehead",
    },
    {
      id: "occ_face_backhair",
      occluder: byKey.face!,
      occludee: byKey.back_hair!,
      notes: "Face over back hair",
    },
    {
      id: "occ_body_arm",
      occluder: byKey.body!,
      occludee: byKey.arm_l!,
      notes: "Body over arm root",
    },
  ];

  void characterId;
  return { layers, edges, byKey };
}

async function tryLlmLayerPlan(opts: {
  imagePath: string;
  width: number;
  height: number;
  providerId: ProviderId;
  projectRoot: string;
}): Promise<TemplateLayerDef[] | null> {
  if (isDryRun()) return null;
  try {
    const provider = createProvider(opts.providerId, { cwd: opts.projectRoot });
    const result = await provider.chat({
      messages: [
        {
          role: "system",
          content:
            "You propose a Live2D-friendly layer plan for an anime-style character portrait. Reply JSON only: { \"layers\": [ { \"key\", \"display_name\", \"semantic\", \"side\": \"LEFT\"|\"RIGHT\"|\"CENTER\", \"z_index\", \"bounds\": {x,y,w,h}, \"asset_file\" } ] }. Bounds are canvas-normalized [0,1]. Prefer: BACK_HAIR, BODY, ARM L/R, FACE, EYE L/R, MOUTH, FRONT_HAIR.",
        },
        {
          role: "user",
          content: `Image path: ${opts.imagePath}\nCanvas: ${opts.width}x${opts.height}\nPropose upper-body rig layers.`,
        },
      ],
      temperature: 0.2,
      response_format: "json",
    });
    const parsed = JSON.parse(result.text) as { layers?: TemplateLayerDef[] };
    if (Array.isArray(parsed.layers) && parsed.layers.length >= 4) {
      return parsed.layers.map((l) => ({
        key: String(l.key ?? l.display_name),
        display_name: String(l.display_name ?? l.key),
        semantic: String(l.semantic).toUpperCase(),
        side: (["LEFT", "RIGHT", "CENTER"].includes(String(l.side))
          ? String(l.side)
          : "CENTER") as "LEFT" | "RIGHT" | "CENTER",
        z_index: Number(l.z_index) || 50,
        bounds: {
          x: Number(l.bounds?.x) || 0,
          y: Number(l.bounds?.y) || 0,
          w: Number(l.bounds?.w) || 0.2,
          h: Number(l.bounds?.h) || 0.2,
        },
        asset_file: String(l.asset_file ?? `${l.key}.png`),
      }));
    }
  } catch {
    /* fall through to template */
  }
  return null;
}

/**
 * Create/overwrite project scaffold from one character design image.
 */
export async function bootstrapProjectFromImage(
  opts: BootstrapFromImageOptions
): Promise<BootstrapResult> {
  const root = path.resolve(opts.projectRoot);
  const imagePath = path.resolve(opts.imagePath);
  await access(imagePath);

  const meta = await sharp(imagePath).metadata();
  const width = meta.width ?? 512;
  const height = meta.height ?? 512;

  await mkdir(path.join(root, "design"), { recursive: true });
  await mkdir(path.join(root, "spec"), { recursive: true });
  await mkdir(path.join(root, "layers"), { recursive: true });
  await mkdir(path.join(root, "masks"), { recursive: true });
  await mkdir(path.join(root, "previews"), { recursive: true });
  await mkdir(path.join(root, "validation"), { recursive: true });
  await mkdir(path.join(root, "psd"), { recursive: true });

  const masterPath = path.join(root, "design", "master_neutral.png");
  const referencePath = path.join(root, "design", "reference.png");
  const normalized = await sharp(imagePath).ensureAlpha().png().toBuffer();
  await writeFile(masterPath, normalized);
  await writeFile(referencePath, normalized);

  const seed = path.basename(root);
  const characterId = createStableId("char", `${seed}:character`);
  const name =
    opts.characterName ??
    (path.basename(root).replace(/[-_]/g, " ") || "Character");

  const character: CharacterSpec = {
    id: characterId,
    name,
    version: "0.1",
    description: `Bootstrapped from single design image: ${path.basename(imagePath)}`,
    art_style: "from_reference",
    canvas: { width, height },
    tags: ["from-image", "bootstrap"],
    notes:
      "Layer plan from template or LLM. Set AI2LIVE_GROK_API_KEY (or OpenAI) for higher-quality plans; dry-run uses deterministic anime upper-body template.",
  };

  const providerId = resolveProviderId(opts.provider) as ProviderId;
  if (opts.dryRun) {
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
  }

  let method: "llm" | "template" = "template";
  let templateLayers = ANIME_UPPER_BODY_TEMPLATE;
  const llmPlan = await tryLlmLayerPlan({
    imagePath,
    width,
    height,
    providerId,
    projectRoot: root,
  });
  if (llmPlan) {
    templateLayers = llmPlan;
    method = "llm";
  }

  // Temporarily override template list for custom LLM plans
  const layers: LayerNode[] = [];
  const byKey: Record<string, string> = {};
  for (const t of templateLayers) {
    const id = createStableId("layer", `${seed}:${t.key}`);
    byKey[t.key] = id;
    layers.push({
      id,
      display_name: t.display_name,
      semantic: t.semantic,
      side: t.side,
      index: 1,
      z_index: t.z_index,
      group: defaultGroupForSemantic(t.semantic),
      canvas_bounds: { ...t.bounds },
      source: {
        type: "master_pixels",
        master_asset_id: "asset_master_neutral",
        asset_path: `layers/${t.asset_file}`,
      },
      status: "DRAFT",
    });
  }

  const edges: OcclusionEdge[] =
    method === "template"
      ? buildLayersFromTemplate(characterId, seed).edges
      : [
          {
            id: "occ_front_face",
            occluder: byKey.front_hair ?? layers[layers.length - 1]!.id,
            occludee: byKey.face ?? layers[0]!.id,
            notes: "Front hair over face (bootstrap)",
          },
        ];

  // If template path, use shared builder for consistent IDs/edges
  let finalLayers = layers;
  let finalEdges = edges;
  if (method === "template") {
    const built = buildLayersFromTemplate(characterId, seed);
    finalLayers = built.layers;
    finalEdges = built.edges;
  }

  const manifest: LayerManifest = {
    id: createStableId("man", `${seed}:manifest`),
    version: "0.1",
    character_id: characterId,
    master_asset_id: "asset_master_neutral",
    canvas: { width, height },
    spatial_references: [
      {
        id: "view_full",
        view_rect_canvas: [0, 0, 1, 1],
        source_pixel_rect: [0, 0, width, height],
        output_size: [width, height],
      },
    ],
    layers: finalLayers,
    occlusion_edges: finalEdges,
  };

  const characterPath = path.join(root, "spec", "character.json");
  const manifestPath = path.join(root, "spec", "layer_manifest.json");
  await writeFile(characterPath, JSON.stringify(character, null, 2));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // Tiny transparent placeholders so paths exist before segment promotes drafts
  const empty = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  for (const layer of finalLayers) {
    const rel = layer.source.asset_path;
    if (!rel) continue;
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    try {
      await access(abs);
    } catch {
      await writeFile(abs, empty);
    }
  }

  return {
    projectRoot: root,
    characterPath,
    manifestPath,
    masterPath,
    referencePath,
    method,
    canvas: { width, height },
  };
}

function segmentSlug(layer: LayerNode): string {
  return `${layer.semantic.toLowerCase()}_${layer.side.toLowerCase()}_${layer.index ?? 1}`;
}

/**
 * After see-through, copy draft RGBA extracts into layers/ paths from the manifest.
 */
export async function promoteSegmentDrafts(projectRoot: string): Promise<string[]> {
  const root = path.resolve(projectRoot);
  const manifestPath = path.join(root, "spec", "layer_manifest.json");
  const { readFile, readdir } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as LayerManifest;
  const promoted: string[] = [];
  const draftDir = path.join(root, "masks", "see_through_layers");

  let draftFiles: string[] = [];
  try {
    draftFiles = await readdir(draftDir);
  } catch {
    draftFiles = [];
  }

  for (const layer of manifest.layers) {
    const slug = segmentSlug(layer);
    const candidates = [
      path.join(draftDir, `${slug}.png`),
      ...draftFiles
        .filter((f) => f.toLowerCase().startsWith(layer.semantic.toLowerCase()))
        .map((f) => path.join(draftDir, f)),
    ];
    let src: string | null = null;
    for (const candidate of candidates) {
      try {
        await access(candidate);
        src = candidate;
        break;
      } catch {
        /* try next */
      }
    }
    if (!src) continue;
    const destRel = layer.source.asset_path ?? `layers/${slug}.png`;
    const dest = path.join(root, destRel);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    layer.source = {
      ...layer.source,
      type: "master_pixels",
      asset_path: destRel,
    };
    layer.status = "READY";
    promoted.push(destRel);
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return promoted;
}
