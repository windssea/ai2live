/**
 * Phase B stub: text → character_spec → synthetic SVG/canvas master for demos.
 * Does not call live image gen; produces a deterministic master PNG from the spec.
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createStableId,
  defaultGroupForSemantic,
  type CharacterSpec,
  type LayerManifest,
  type LayerNode,
  type OcclusionEdge,
} from "@ai2live/domain";
import { ANIME_UPPER_BODY_TEMPLATE } from "./bootstrap.js";

export interface InitFromTextOptions {
  projectRoot: string;
  text: string;
  characterName?: string;
  width?: number;
  height?: number;
}

export interface InitFromTextResult {
  projectRoot: string;
  characterPath: string;
  characterSpecPath: string;
  manifestPath: string;
  masterPath: string;
  method: "synthetic_svg_master";
  canvas: { width: number; height: number };
}

/** Heuristic parse of free-text into DESIGN-ish character_spec fields. */
export function textToCharacterSpec(opts: {
  text: string;
  name?: string;
  characterId: string;
  canvas: { width: number; height: number };
}): CharacterSpec & {
  style?: string;
  body_crop?: string;
  pose?: string;
  hair?: Record<string, unknown>;
  eyes?: Record<string, unknown>;
  outfit?: Record<string, unknown>;
  accessories?: unknown[];
  target_backends?: string[];
  quality_tier?: string;
  source_text?: string;
} {
  const t = opts.text.trim();
  const lower = t.toLowerCase();
  const hairColor =
    (lower.match(/\b(pink|blue|silver|white|black|blonde|red|green|purple|orange)\b/) ?? [])[0] ??
    "auburn";
  const eyeColor =
    (lower.match(/\b(red|blue|green|gold|amber|violet|brown)\s*eyes?\b/) ?? [])[0]?.split(/\s/)[0] ??
    "amber";
  const longHair = /long\s+hair|twintail|ponytail|bangs/.test(lower);
  const style = /chibi/.test(lower)
    ? "anime_chibi"
    : /realistic/.test(lower)
      ? "semi_realistic"
      : "anime_cel_clean";

  const name =
    opts.name ??
    (t.match(/(?:named|name[d]?)\s+[「"']?([A-Za-zА-Яа-я\u4e00-\u9fff]{2,24})/)?.[1] ??
      "DemoCharacter");

  return {
    id: opts.characterId,
    name,
    version: "0.1",
    description: t.slice(0, 2000),
    art_style: style,
    canvas: opts.canvas,
    identity_prompt: t.slice(0, 500),
    tags: ["from-text", "phase-b-stub", style],
    notes: "Synthetic master from text stub — replace with live image gen for production",
    style,
    body_crop: /full[\s-]?body/.test(lower) ? "full_body" : "upper_body",
    pose: "front_relaxed_t_pose",
    hair: {
      color: hairColor,
      length: longHair ? "long" : "medium",
      bangs: /bang|fringe|刘海/.test(lower),
    },
    eyes: { color: eyeColor, style: "anime" },
    outfit: { summary: t.slice(0, 240) },
    accessories: [],
    target_backends: ["psd2live", "autolive2d"],
    quality_tier: "demo",
    source_text: t,
  };
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Build an SVG synthetic master illustration from character_spec. */
export function syntheticMasterSvg(
  spec: ReturnType<typeof textToCharacterSpec>,
  width: number,
  height: number
): string {
  const hue = hashHue(spec.name + (spec.hair?.color as string));
  const hairHue = hashHue(String(spec.hair?.color ?? "hair"));
  const eyeHue = hashHue(String(spec.eyes?.color ?? "eye") + "eye");
  const cx = width * 0.5;
  const headY = height * 0.28;
  const headR = Math.min(width, height) * 0.18;
  const bodyTop = headY + headR * 0.85;
  const name = String(spec.name).replace(/[<>&]/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="hsl(${(hue + 40) % 360},40%,92%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 80) % 360},35%,85%)"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <!-- back hair -->
  <ellipse cx="${cx}" cy="${headY + headR * 0.3}" rx="${headR * 1.35}" ry="${headR * 1.6}" fill="hsl(${hairHue},55%,42%)"/>
  <!-- body -->
  <path d="M ${cx - headR * 0.9} ${bodyTop}
           Q ${cx} ${bodyTop + headR * 0.2} ${cx + headR * 0.9} ${bodyTop}
           L ${cx + headR * 1.1} ${height * 0.92}
           L ${cx - headR * 1.1} ${height * 0.92} Z"
        fill="hsl(${(hue + 180) % 360},45%,55%)"/>
  <!-- arms -->
  <rect x="${cx - headR * 1.55}" y="${bodyTop + headR * 0.15}" width="${headR * 0.45}" height="${headR * 1.6}" rx="12" fill="hsl(${(hue + 20) % 360},40%,70%)"/>
  <rect x="${cx + headR * 1.1}" y="${bodyTop + headR * 0.15}" width="${headR * 0.45}" height="${headR * 1.6}" rx="12" fill="hsl(${(hue + 20) % 360},40%,70%)"/>
  <!-- face -->
  <circle cx="${cx}" cy="${headY}" r="${headR}" fill="hsl(25,55%,88%)" stroke="hsl(20,30%,40%)" stroke-width="2"/>
  <!-- eyes -->
  <ellipse cx="${cx - headR * 0.35}" cy="${headY - headR * 0.05}" rx="${headR * 0.18}" ry="${headR * 0.22}" fill="hsl(${eyeHue},60%,45%)"/>
  <ellipse cx="${cx + headR * 0.35}" cy="${headY - headR * 0.05}" rx="${headR * 0.18}" ry="${headR * 0.22}" fill="hsl(${eyeHue},60%,45%)"/>
  <circle cx="${cx - headR * 0.32}" cy="${headY - headR * 0.08}" r="${headR * 0.06}" fill="#fff"/>
  <circle cx="${cx + headR * 0.38}" cy="${headY - headR * 0.08}" r="${headR * 0.06}" fill="#fff"/>
  <!-- mouth -->
  <path d="M ${cx - headR * 0.2} ${headY + headR * 0.35} Q ${cx} ${headY + headR * 0.5} ${cx + headR * 0.2} ${headY + headR * 0.35}"
        fill="none" stroke="hsl(0,50%,45%)" stroke-width="3" stroke-linecap="round"/>
  <!-- bangs / front hair -->
  <path d="M ${cx - headR * 1.05} ${headY - headR * 0.2}
           Q ${cx - headR * 0.4} ${headY - headR * 1.2} ${cx} ${headY - headR * 0.55}
           Q ${cx + headR * 0.4} ${headY - headR * 1.2} ${cx + headR * 1.05} ${headY - headR * 0.2}
           Q ${cx} ${headY + headR * 0.15} ${cx - headR * 1.05} ${headY - headR * 0.2} Z"
        fill="hsl(${hairHue},60%,38%)"/>
  <text x="${cx}" y="${height - 16}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="rgba(0,0,0,0.55)">
    ${name} · synthetic master (text stub)
  </text>
</svg>`;
}

/**
 * Init a demo project from free text: character_spec + synthetic master + template layers.
 */
export async function initProjectFromText(opts: InitFromTextOptions): Promise<InitFromTextResult> {
  const root = path.resolve(opts.projectRoot);
  const width = opts.width ?? 512;
  const height = opts.height ?? 768;
  const seed = path.basename(root) || "text-demo";
  const characterId = createStableId("char", `${seed}:character`);

  await mkdir(path.join(root, "design"), { recursive: true });
  await mkdir(path.join(root, "spec"), { recursive: true });
  await mkdir(path.join(root, "layers"), { recursive: true });
  await mkdir(path.join(root, "masks"), { recursive: true });
  await mkdir(path.join(root, "previews"), { recursive: true });
  await mkdir(path.join(root, "validation"), { recursive: true });
  await mkdir(path.join(root, "psd"), { recursive: true });

  const spec = textToCharacterSpec({
    text: opts.text,
    name: opts.characterName,
    characterId,
    canvas: { width, height },
  });

  const characterPath = path.join(root, "spec", "character.json");
  const characterSpecPath = path.join(root, "spec", "character_spec.json");
  await writeFile(characterPath, JSON.stringify(spec, null, 2) + "\n");
  await writeFile(characterSpecPath, JSON.stringify(spec, null, 2) + "\n");

  const svg = syntheticMasterSvg(spec, width, height);
  const masterPath = path.join(root, "design", "master_neutral.png");
  await sharp(Buffer.from(svg)).png().toFile(masterPath);
  await sharp(Buffer.from(svg)).png().toFile(path.join(root, "design", "reference.png"));

  // Crop template layers from synthetic master using bounds (visible stub assets)
  const layers: LayerNode[] = [];
  const byKey: Record<string, string> = {};
  const masterBuf = await sharp(masterPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  for (const t of ANIME_UPPER_BODY_TEMPLATE) {
    const id = createStableId("layer", `${seed}:${t.key}`);
    byKey[t.key] = id;
    const x = Math.round(t.bounds.x * width);
    const y = Math.round(t.bounds.y * height);
    const w = Math.max(1, Math.round(t.bounds.w * width));
    const h = Math.max(1, Math.round(t.bounds.h * height));
    const assetRel = `layers/${t.asset_file}`;
    const abs = path.join(root, assetRel);
    await sharp(masterBuf.data, {
      raw: { width: masterBuf.info.width, height: masterBuf.info.height, channels: 4 },
    })
      .extract({
        left: Math.min(x, width - 1),
        top: Math.min(y, height - 1),
        width: Math.min(w, width - x),
        height: Math.min(h, height - y),
      })
      .png()
      .toFile(abs);

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
        type: "generated_standalone",
        master_asset_id: "asset_master_neutral",
        asset_path: assetRel,
      },
      status: "DRAFT",
    });
  }

  const edges: OcclusionEdge[] = [
    {
      id: "occ_bang_face",
      occluder: byKey.front_hair!,
      occludee: byKey.face!,
      notes: "Bangs over forehead",
      motion_risk: "high",
      completion_required: true,
      region_mask: "masks/completion_bangs_under_face.png",
    },
    {
      id: "occ_face_backhair",
      occluder: byKey.face!,
      occludee: byKey.back_hair!,
      notes: "Face over back hair",
      motion_risk: "medium",
      completion_required: true,
      region_mask: "masks/completion_face_over_back_hair.png",
    },
    {
      id: "occ_body_arm",
      occluder: byKey.body!,
      occludee: byKey.arm_l!,
      notes: "Body over arm root",
      motion_risk: "medium",
      completion_required: true,
      region_mask: "masks/completion_body_over_arm_root.png",
    },
  ];

  const manifest: LayerManifest = {
    id: createStableId("manifest", `${seed}:manifest`),
    version: "0.1",
    character_id: characterId,
    master_asset_id: "asset_master_neutral",
    canvas: { width, height },
    layers,
    occlusion_edges: edges,
  };
  const manifestPath = path.join(root, "spec", "layer_manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // Also write occlusion_graph.json (DESIGN tree)
  await writeFile(
    path.join(root, "spec", "occlusion_graph.json"),
    JSON.stringify(
      {
        version: "0.2",
        character_id: characterId,
        edges,
        note: "Richer occlusion graph with motion_risk / region_mask / completion_required",
      },
      null,
      2
    ) + "\n"
  );

  return {
    projectRoot: root,
    characterPath,
    characterSpecPath,
    manifestPath,
    masterPath,
    method: "synthetic_svg_master",
    canvas: { width, height },
  };
}
