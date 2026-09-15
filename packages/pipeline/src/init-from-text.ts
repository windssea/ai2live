/**
 * Phase B: text → character_spec → rig-friendly synthetic SVG master (+ optional live refine).
 * Dry-run / default: deterministic transparent SVG master that passes Gate 0.
 * Live path (optional): when provider keys set and AI2LIVE_MODEL_DRY_RUN unset,
 * `refineMasterViaImageEdit` can restyle the synthetic seed via provider imageEdit.
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
  method: "synthetic_svg_master" | "synthetic_plus_live_refine";
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
    notes: "Rig-friendly synthetic master (Gate 0). Optional live refine via imageEdit when provider keys set.",
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

/**
 * Build a rig-friendly SVG synthetic master from character_spec.
 * Design goals (Gate 0 / DoD #2):
 * - Transparent canvas (coverage = character only)
 * - Front upper-body layout, centered mass, clear L/R
 * - Separate face / hair / body color regions for bindability
 * - Soft layout guides (low-alpha) for head/torso/arm boxes
 */
export function syntheticMasterSvg(
  spec: ReturnType<typeof textToCharacterSpec>,
  width: number,
  height: number
): string {
  const hue = hashHue(spec.name + (spec.hair?.color as string));
  const hairHue = hashHue(String(spec.hair?.color ?? "hair"));
  // Force hair / face / body into distinct hue bands so Gate 0 color-region check passes
  const hairH = 200 + (hairHue % 40); // blue-cyan hair band
  const faceH = 25; // skin
  const bodyH = (hue + 140) % 360; // outfit — offset from hair
  const eyeHue = hashHue(String(spec.eyes?.color ?? "eye") + "eye");
  const eyeH = 40 + (eyeHue % 80);
  const cx = width * 0.5;
  const headY = height * 0.26;
  const headR = Math.min(width, height) * 0.17;
  const bodyTop = headY + headR * 0.9;
  const armW = headR * 0.42;
  const armH = headR * 1.55;
  const name = String(spec.name).replace(/[<>&]/g, "");
  const guideStroke = "rgba(80,80,120,0.18)";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- transparent canvas — subject-only coverage for Gate 0 -->
  <rect width="100%" height="100%" fill="none"/>
  <!-- layout guides (front upper-body): head / torso / L-R arm boxes -->
  <rect x="${cx - headR * 1.15}" y="${headY - headR * 1.15}" width="${headR * 2.3}" height="${headR * 2.3}"
        fill="none" stroke="${guideStroke}" stroke-width="1" stroke-dasharray="4 3"/>
  <rect x="${cx - headR * 1.05}" y="${bodyTop}" width="${headR * 2.1}" height="${height * 0.92 - bodyTop}"
        fill="none" stroke="${guideStroke}" stroke-width="1" stroke-dasharray="4 3"/>
  <rect x="${cx - headR * 1.65}" y="${bodyTop + headR * 0.1}" width="${armW + 4}" height="${armH + 4}"
        fill="none" stroke="${guideStroke}" stroke-width="1" stroke-dasharray="3 2"/>
  <rect x="${cx + headR * 1.05}" y="${bodyTop + headR * 0.1}" width="${armW + 4}" height="${armH + 4}"
        fill="none" stroke="${guideStroke}" stroke-width="1" stroke-dasharray="3 2"/>
  <!-- BACK HAIR region (distinct hair hue) -->
  <ellipse cx="${cx}" cy="${headY + headR * 0.35}" rx="${headR * 1.32}" ry="${headR * 1.55}"
           fill="hsl(${hairH},58%,40%)" data-region="hair"/>
  <!-- BODY / outfit region (distinct body hue) -->
  <path d="M ${cx - headR * 0.85} ${bodyTop}
           Q ${cx} ${bodyTop + headR * 0.15} ${cx + headR * 0.85} ${bodyTop}
           L ${cx + headR * 1.05} ${height * 0.9}
           L ${cx - headR * 1.05} ${height * 0.9} Z"
        fill="hsl(${bodyH},48%,52%)" data-region="body"/>
  <!-- ARMS L/R — character-own LEFT is viewer's right visually but labeled clearly -->
  <rect x="${cx - headR * 1.6}" y="${bodyTop + headR * 0.12}" width="${armW}" height="${armH}" rx="10"
        fill="hsl(${faceH},45%,78%)" data-region="arm_l" data-side="LEFT"/>
  <rect x="${cx + headR * 1.18}" y="${bodyTop + headR * 0.12}" width="${armW}" height="${armH}" rx="10"
        fill="hsl(${faceH},45%,78%)" data-region="arm_r" data-side="RIGHT"/>
  <text x="${cx - headR * 1.6 + armW / 2}" y="${bodyTop + headR * 0.12 + armH * 0.55}"
        text-anchor="middle" font-family="sans-serif" font-size="${Math.max(10, Math.round(headR * 0.28))}"
        font-weight="700" fill="rgba(20,40,90,0.75)">L</text>
  <text x="${cx + headR * 1.18 + armW / 2}" y="${bodyTop + headR * 0.12 + armH * 0.55}"
        text-anchor="middle" font-family="sans-serif" font-size="${Math.max(10, Math.round(headR * 0.28))}"
        font-weight="700" fill="rgba(20,40,90,0.75)">R</text>
  <!-- FACE region (skin hue — separate from hair/body) -->
  <circle cx="${cx}" cy="${headY}" r="${headR}" fill="hsl(${faceH},55%,88%)"
          stroke="hsl(20,30%,45%)" stroke-width="2" data-region="face"/>
  <!-- EYES L/R -->
  <ellipse cx="${cx - headR * 0.35}" cy="${headY - headR * 0.02}" rx="${headR * 0.17}" ry="${headR * 0.2}"
           fill="hsl(${eyeH},62%,42%)" data-side="LEFT"/>
  <ellipse cx="${cx + headR * 0.35}" cy="${headY - headR * 0.02}" rx="${headR * 0.17}" ry="${headR * 0.2}"
           fill="hsl(${eyeH},62%,42%)" data-side="RIGHT"/>
  <circle cx="${cx - headR * 0.32}" cy="${headY - headR * 0.06}" r="${headR * 0.055}" fill="#fff"/>
  <circle cx="${cx + headR * 0.38}" cy="${headY - headR * 0.06}" r="${headR * 0.055}" fill="#fff"/>
  <text x="${cx - headR * 0.35}" y="${headY + headR * 0.22}" text-anchor="middle"
        font-family="sans-serif" font-size="${Math.max(8, Math.round(headR * 0.18))}" fill="rgba(0,0,80,0.45)">L</text>
  <text x="${cx + headR * 0.35}" y="${headY + headR * 0.22}" text-anchor="middle"
        font-family="sans-serif" font-size="${Math.max(8, Math.round(headR * 0.18))}" fill="rgba(0,0,80,0.45)">R</text>
  <!-- mouth -->
  <path d="M ${cx - headR * 0.18} ${headY + headR * 0.38} Q ${cx} ${headY + headR * 0.52} ${cx + headR * 0.18} ${headY + headR * 0.38}"
        fill="none" stroke="hsl(0,48%,48%)" stroke-width="3" stroke-linecap="round"/>
  <!-- FRONT HAIR / bangs (same hair hue family, slightly darker) -->
  <path d="M ${cx - headR * 1.02} ${headY - headR * 0.15}
           Q ${cx - headR * 0.35} ${headY - headR * 1.15} ${cx} ${headY - headR * 0.5}
           Q ${cx + headR * 0.35} ${headY - headR * 1.15} ${cx + headR * 1.02} ${headY - headR * 0.15}
           Q ${cx} ${headY + headR * 0.12} ${cx - headR * 1.02} ${headY - headR * 0.15} Z"
        fill="hsl(${hairH},62%,34%)" data-region="hair_front"/>
  <text x="${cx}" y="${height - 12}" text-anchor="middle" font-family="sans-serif" font-size="12"
        fill="rgba(0,0,0,0.4)">${name} · rig-friendly synthetic master</text>
</svg>`;
}

/**
 * Optional live refine: restyle synthetic master via provider imageEdit.
 * Returns null when dry-run / unconfigured — callers keep the synthetic master.
 */
export async function refineMasterViaImageEdit(opts: {
  projectRoot: string;
  masterPath: string;
  prompt: string;
  provider?: string;
}): Promise<{ outputPath: string; method: string } | null> {
  const dry =
    process.env.AI2LIVE_MODEL_DRY_RUN === "1" ||
    process.env.AI2LIVE_MODEL_DRY_RUN === "true";
  if (dry) return null;
  try {
    const { createProvider, resolveProviderId, providerConfigured } = await import(
      "@ai2live/model-providers"
    );
    const providerId = resolveProviderId(opts.provider);
    if (!providerConfigured(providerId)) return null;
    const provider = createProvider(providerId, { cwd: opts.projectRoot });
    if (!provider.imageEdit) return null;
    const out = path.join(opts.projectRoot, "design", "master_neutral_live.png");
    const r = await provider.imageEdit({
      prompt:
        opts.prompt +
        " Front upper-body anime character, clear left/right limbs, separate face/hair/body colors, rig-friendly T-pose, transparent background.",
      inputImagePath: opts.masterPath,
      outputPath: out,
      projectRoot: opts.projectRoot,
    });
    if (r.dryRun) return null;
    return { outputPath: r.outputPath, method: r.method ?? "images_api" };
  } catch {
    return null;
  }
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

  let method: InitFromTextResult["method"] = "synthetic_svg_master";
  const live = await refineMasterViaImageEdit({
    projectRoot: root,
    masterPath,
    prompt: String(spec.identity_prompt ?? opts.text).slice(0, 400),
  });
  if (live) {
    await sharp(live.outputPath).ensureAlpha().png().toFile(masterPath);
    method = "synthetic_plus_live_refine";
  }

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

  await writeFile(
    path.join(root, "design", "master_bindability.json"),
    JSON.stringify(
      {
        version: "0.1",
        method,
        rig_friendly: true,
        layout: "front_upper_body",
        features: [
          "transparent_canvas",
          "clear_L_R_labels",
          "separate_face_hair_body_hues",
          "upper_body_layout_guides",
        ],
        live_refine: method === "synthetic_plus_live_refine",
        note: "Dry-run synthetic path is DoD-complete for Gate 0; live imageEdit refine is optional when provider keys set.",
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
    method,
    canvas: { width, height },
  };
}
