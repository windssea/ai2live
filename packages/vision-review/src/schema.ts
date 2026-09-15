/**
 * Structured JSON schema for VLM vision review (DESIGN §16).
 * Used as response_format guidance and for parse/validate of model output.
 */

export const VLM_REVIEW_SCHEMA_VERSION = "0.2" as const;

/** JSON Schema (draft-ish) describing the expected VLM reply object. */
export const VLM_REVIEW_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ai2live.dev/schemas/vlm-review-response.json",
  title: "VlmReviewResponse",
  type: "object",
  additionalProperties: false,
  required: ["passed", "summary", "issues", "scores"],
  properties: {
    passed: { type: "boolean", description: "Overall vision pass" },
    summary: { type: "string", maxLength: 2000 },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["code", "severity", "message"],
        additionalProperties: false,
        properties: {
          code: {
            type: "string",
            enum: [
              "hair_unnatural",
              "occlusion_gap",
              "face_crack",
              "eye_drift",
              "mouth_misalign",
              "layer_bleed",
              "identity_drift",
              "other",
            ],
          },
          severity: { type: "string", enum: ["ERROR", "WARNING", "INFO"] },
          message: { type: "string" },
          region: { type: "string" },
        },
      },
    },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["overall"],
      properties: {
        overall: { type: "number", minimum: 0, maximum: 1 },
        hair_naturalness: { type: "number", minimum: 0, maximum: 1 },
        occlusion_integrity: { type: "number", minimum: 0, maximum: 1 },
        face_continuity: { type: "number", minimum: 0, maximum: 1 },
        eye_alignment: { type: "number", minimum: 0, maximum: 1 },
        identity_consistency: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

export interface VlmReviewIssue {
  code: string;
  severity: "ERROR" | "WARNING" | "INFO";
  message: string;
  region?: string;
}

export interface VlmReviewScores {
  overall: number;
  hair_naturalness?: number;
  occlusion_integrity?: number;
  face_continuity?: number;
  eye_alignment?: number;
  identity_consistency?: number;
}

export interface VlmReviewStructured {
  passed: boolean;
  summary: string;
  issues: VlmReviewIssue[];
  scores: VlmReviewScores;
  recommendations?: string[];
}

/** Parse and lightly validate VLM JSON; coerce loose shapes. */
export function parseVlmReviewJson(text: string): VlmReviewStructured {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      passed: false,
      summary: text.slice(0, 200),
      issues: [
        {
          code: "other",
          severity: "ERROR",
          message: "unparseable_vlm_json",
        },
      ],
      scores: { overall: 0 },
    };
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const issuesRaw = Array.isArray(obj.issues) ? obj.issues : [];
  const issues: VlmReviewIssue[] = issuesRaw.map((it) => {
    if (typeof it === "string") {
      return { code: "other", severity: "WARNING", message: it };
    }
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const sev = String(o.severity ?? "WARNING").toUpperCase();
    return {
      code: String(o.code ?? "other"),
      severity: (sev === "ERROR" || sev === "INFO" ? sev : "WARNING") as VlmReviewIssue["severity"],
      message: String(o.message ?? o.code ?? "issue"),
      region: o.region != null ? String(o.region) : undefined,
    };
  });
  const scoresObj = (obj.scores && typeof obj.scores === "object" ? obj.scores : {}) as Record<
    string,
    unknown
  >;
  const clamp01 = (n: unknown, fallback: number) => {
    const v = typeof n === "number" ? n : fallback;
    return Math.max(0, Math.min(1, v));
  };
  const scores: VlmReviewScores = {
    overall: clamp01(scoresObj.overall, obj.passed === true ? 0.85 : 0.35),
  };
  for (const k of [
    "hair_naturalness",
    "occlusion_integrity",
    "face_continuity",
    "eye_alignment",
    "identity_consistency",
  ] as const) {
    if (typeof scoresObj[k] === "number") scores[k] = clamp01(scoresObj[k], 0.5);
  }
  const passed =
    typeof obj.passed === "boolean"
      ? obj.passed
      : scores.overall >= 0.6 && !issues.some((i) => i.severity === "ERROR");
  const recommendations = Array.isArray(obj.recommendations)
    ? obj.recommendations.map(String)
    : undefined;
  return {
    passed,
    summary: String(obj.summary ?? (passed ? "VLM pass" : "VLM fail")),
    issues,
    scores,
    recommendations,
  };
}

export function vlmSystemPrompt(): string {
  return [
    "You are a Live2D asset vision reviewer for anime character layer packages.",
    "Return ONLY valid JSON matching this schema keys: passed, summary, issues[], scores{}, recommendations[].",
    "scores.overall in [0,1]. issue codes: hair_unnatural|occlusion_gap|face_crack|eye_drift|mouth_misalign|layer_bleed|identity_drift|other.",
    "Focus on hair naturalness, occlusion integrity, face cracks, eye drift, identity consistency.",
    `schema_version=${VLM_REVIEW_SCHEMA_VERSION}`,
  ].join("\n");
}
