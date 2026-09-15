/** Character-own side (not viewer/camera side). LEFT = character's left. */
export type Side = "LEFT" | "RIGHT" | "CENTER" | "BOTH" | "NONE";

export type SourceType =
  | "master_pixels"
  | "master_plus_completion"
  | "full_character_differential"
  | "generated_standalone"
  | "clone"
  | "user_asset"
  | "fallback_separator";

export type LayerStatus = "DRAFT" | "READY" | "VALIDATED" | "FAILED";

export interface CanvasSize {
  width: number;
  height: number;
}

/** Normalized canvas bounds x,y,w,h in [0,1] */
export interface CanvasBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Spatial reference tying a generation/edit output back to canvas space.
 * Output size changing does NOT mean the subject scaled on canvas.
 */
export interface SpatialReference {
  id: string;
  /** [x, y, w, h] canvas-normalized */
  view_rect_canvas: [number, number, number, number];
  /** [x, y, w, h] source pixel rect */
  source_pixel_rect: [number, number, number, number];
  /** [width, height] of the output image */
  output_size: [number, number];
}

export interface LayerSource {
  type: SourceType;
  master_asset_id?: string;
  visible_mask_id?: string;
  completion_asset_id?: string;
  /** Relative path to RGBA PNG (M0 hand-authored) */
  asset_path?: string;
  clone_of?: string;
}

export interface LayerNode {
  id: string;
  display_name: string;
  semantic: string;
  subtype?: string;
  side: Side;
  index?: number;
  parent?: string | null;
  z_index: number;
  canvas_bounds?: CanvasBounds;
  pivot_hint?: [number, number];
  motion_owner_hint?: string;
  physics_hint?: string;
  source: LayerSource;
  overlap?: {
    required_with?: string[];
    minimum_px_at_master_resolution?: number;
  };
  provenance?: Record<string, unknown>;
  status?: LayerStatus;
  /** PSD group bucket e.g. FRONT_HAIR */
  group?: string;
}

export interface OcclusionEdge {
  id?: string;
  occluder: string;
  occludee: string;
  region_hint?: CanvasBounds;
  notes?: string;
  /** Pose / motion risk when occluder moves (HeadX/Y etc.). */
  motion_risk?: "low" | "medium" | "high";
  /** Relative path to region mask PNG (opaque = completion ROI). */
  region_mask?: string;
  /** Whether hidden-region completion is required for this edge. */
  completion_required?: boolean;
}

export interface LayerManifest {
  id: string;
  version: "0.1";
  character_id: string;
  master_asset_id?: string;
  canvas: CanvasSize;
  spatial_references?: SpatialReference[];
  layers: LayerNode[];
  occlusion_edges?: OcclusionEdge[];
  groups?: { name: string; layer_ids: string[] }[];
}

export interface CharacterSpec {
  id: string;
  name: string;
  version: "0.1";
  description?: string;
  art_style?: string;
  canvas?: CanvasSize;
  identity_prompt?: string;
  tags?: string[];
  notes?: string;
  /** DESIGN Phase A extras (optional). */
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
}

export type FindingSeverity = "INFO" | "WARNING" | "ERROR";

export interface ValidationFinding {
  id: string;
  severity: FindingSeverity;
  type: string;
  backend?: string;
  pose?: Record<string, number>;
  region_canvas?: [number, number, number, number];
  related_layers?: string[];
  hypothesis?: string;
  recommended_action?: string;
  source_screenshot?: string;
  message?: string;
}

export interface ValidationReport {
  id: string;
  version: "0.1";
  project_path: string;
  timestamp?: string;
  passed: boolean;
  gate?: string;
  metrics: Record<string, number>;
  findings: ValidationFinding[];
  artifacts?: Record<string, string>;
}

/** Default PSD group order (top = front). */
export const PSD_GROUP_ORDER = [
  "ACCESSORY_FRONT",
  "FRONT_HAIR",
  "FACE_DETAIL",
  "EYES",
  "FACE",
  "ACCESSORY_MID",
  "NECK",
  "BODY",
  "ARMS",
  "BACK_HAIR",
  "ACCESSORY_BACK",
  "OTHER",
] as const;

export type PsdGroupName = (typeof PSD_GROUP_ORDER)[number] | string;

/** Map semantic → default PSD group */
export function defaultGroupForSemantic(semantic: string): string {
  const s = semantic.toUpperCase();
  if (s.includes("FRONT_HAIR") || s === "BANG") return "FRONT_HAIR";
  if (s.includes("BACK_HAIR")) return "BACK_HAIR";
  if (s.includes("IRIS") || s.includes("EYE") || s.includes("LASH") || s.includes("BROW")) return "EYES";
  if (s.includes("MOUTH") || s.includes("NOSE") || s.includes("BLUSH")) return "FACE_DETAIL";
  if (s.includes("FACE") || s.includes("HEAD")) return "FACE";
  if (s.includes("NECK")) return "NECK";
  if (s.includes("ARM") || s.includes("HAND")) return "ARMS";
  if (s.includes("BODY") || s.includes("TORSO") || s.includes("CLOTH")) return "BODY";
  if (s.includes("ACCESSORY") || s.includes("HAT") || s.includes("GLASS")) return "ACCESSORY_FRONT";
  return "OTHER";
}

/**
 * PSD display name: <semantic>_<side>_<index>__<short-id>
 * side letters: l/r/c/b/n
 */
export function formatLayerPsdName(layer: LayerNode, short: string): string {
  const sideLetter: Record<Side, string> = {
    LEFT: "l",
    RIGHT: "r",
    CENTER: "c",
    BOTH: "b",
    NONE: "n",
  };
  const sem = layer.semantic.toLowerCase();
  const idx = String(layer.index ?? 1).padStart(2, "0");
  return `${sem}_${sideLetter[layer.side]}_${idx}__${short}`;
}
