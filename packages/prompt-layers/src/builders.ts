/**
 * DESIGN §15.1 — Prompt layering builders.
 * Compose Identity / Art Style / Rigability / Edit Delta / Negatives
 * instead of one mega-string for imageEdit (occlusion + expression).
 */

export interface CharacterIdentityHints {
  name?: string;
  hair?: string;
  eyes?: string;
  outfit?: string;
  faceShape?: string;
  notes?: string;
}

export interface StyleHints {
  medium?: string;
  lineWeight?: string;
  palette?: string;
  shading?: string;
  notes?: string;
}

export interface RigabilityHints {
  overlapPx?: number;
  keepAlphaHoles?: boolean;
  preferSeparateParts?: boolean;
  notes?: string;
}

export interface EditDeltaHints {
  /** What to change (only this). */
  change: string;
  /** What must stay locked. */
  lock?: string;
  /** Optional ROI description. */
  roi?: string;
}

export interface NegativesHints {
  extra?: string[];
}

const DEFAULT_NEGATIVES = [
  "do not regenerate the whole image",
  "do not change identity, hairstyle silhouette, outfit, or proportions outside the edit region",
  "do not move the camera, pose, or background",
  "do not add text, watermarks, or extra limbs",
  "do not flatten separate Live2D parts into one opaque blob",
];

export function buildIdentityPrompt(hints: CharacterIdentityHints = {}): string {
  const parts = [
    "Identity:",
    "keep the same character identity,",
    hints.name ? `named "${hints.name}",` : null,
    hints.faceShape ? `face shape ${hints.faceShape},` : "face shape,",
    hints.eyes ? `eyes ${hints.eyes},` : "eye spacing,",
    hints.hair ? `hair ${hints.hair},` : "hairstyle,",
    hints.outfit ? `outfit ${hints.outfit},` : "outfit,",
    "and overall proportions unchanged.",
    hints.notes ?? null,
  ].filter(Boolean);
  return parts.join(" ");
}

export function buildStylePrompt(hints: StyleHints = {}): string {
  const parts = [
    "Art Style:",
    hints.medium ?? "anime-style illustration",
    hints.lineWeight ? `with ${hints.lineWeight} line work` : "with clean line work",
    hints.palette ? `palette ${hints.palette}` : "consistent palette",
    hints.shading ? `shading ${hints.shading}` : "soft cel shading",
    "— match the reference exactly.",
    hints.notes ?? null,
  ].filter(Boolean);
  return parts.join(" ");
}

export function buildRigabilityPrompt(hints: RigabilityHints = {}): string {
  const overlap = hints.overlapPx ?? 8;
  const parts = [
    "Rigability:",
    `preserve soft overlap (≥${overlap}px) for Live2D part seams,`,
    hints.keepAlphaHoles !== false
      ? "keep intentional alpha holes and feathered edges,"
      : null,
    hints.preferSeparateParts !== false
      ? "prefer separable RGBA parts over baked composites,"
      : null,
    "do not introduce hard cutouts that break head-turn continuity.",
    hints.notes ?? null,
  ].filter(Boolean);
  return parts.join(" ");
}

export function buildEditDeltaPrompt(hints: EditDeltaHints): string {
  const lock =
    hints.lock ??
    "keep full-character identity, hairstyle, outfit, proportions, pose, and background unchanged";
  const parts = [
    "Edit Delta:",
    lock + ".",
    "Change ONLY:",
    hints.change,
    hints.roi ? `ROI: ${hints.roi}.` : null,
    "Fill only the masked / named region; do not redraw visible pixels outside it.",
  ].filter(Boolean);
  return parts.join(" ");
}

export function buildNegativesPrompt(hints: NegativesHints = {}): string {
  const items = [...DEFAULT_NEGATIVES, ...(hints.extra ?? [])];
  return `Negative Constraints: ${items.join("; ")}.`;
}

export interface LayeredPromptInput {
  identity?: CharacterIdentityHints;
  style?: StyleHints;
  rigability?: RigabilityHints;
  editDelta: EditDeltaHints;
  negatives?: NegativesHints;
  /** Optional pose/composition line. */
  poseComposition?: string;
}

export interface LayeredPrompt {
  identity: string;
  style: string;
  rigability: string;
  editDelta: string;
  negatives: string;
  poseComposition?: string;
  /** Joined prompt suitable for provider.imageEdit */
  combined: string;
}

export function buildLayeredPrompt(input: LayeredPromptInput): LayeredPrompt {
  const identity = buildIdentityPrompt(input.identity);
  const style = buildStylePrompt(input.style);
  const rigability = buildRigabilityPrompt(input.rigability);
  const editDelta = buildEditDeltaPrompt(input.editDelta);
  const negatives = buildNegativesPrompt(input.negatives);
  const poseComposition = input.poseComposition
    ? `Pose/Composition: ${input.poseComposition}`
    : undefined;
  const combined = [identity, style, rigability, poseComposition, editDelta, negatives]
    .filter(Boolean)
    .join("\n");
  return { identity, style, rigability, editDelta, negatives, poseComposition, combined };
}

/** Occlusion scenario → Edit Delta change text. */
export function occlusionEditDelta(
  scenario: "bangs_under_face" | "face_over_back_hair" | "body_over_arm_root"
): EditDeltaHints {
  switch (scenario) {
    case "bangs_under_face":
      return {
        change:
          "complete forehead / face skin naturally under bangs occlusion (hidden region only)",
        roi: "forehead and upper face under front hair mask",
      };
    case "face_over_back_hair":
      return {
        change: "complete back-hair strands hidden under the face silhouette",
        roi: "back hair under face mask",
      };
    case "body_over_arm_root":
      return {
        change: "complete arm-root / shoulder join hidden under the body layer",
        roi: "arm root under body mask",
      };
  }
}

/** Expression kind → Edit Delta change text. */
export function expressionEditDelta(
  kind: "mouth_open" | "eye_close" | "smile" | "special_eye"
): EditDeltaHints {
  switch (kind) {
    case "mouth_open":
      return {
        change:
          "open the mouth to a natural maximum speaking pose; keep teeth/tongue style-consistent",
        roi: "mouth only",
      };
    case "eye_close":
      return {
        change: "close both eyes with natural lashes; keep brows and face unchanged",
        roi: "eyes only",
      };
    case "smile":
      return {
        change: "soft smile on the mouth only; eyes stay open and identity-locked",
        roi: "mouth only",
      };
    case "special_eye":
      return {
        change: "special-eye highlight/color shift on irises only; keep eye shape",
        roi: "irises only",
      };
  }
}
