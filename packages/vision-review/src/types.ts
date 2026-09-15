/** DESIGN §16 dual-judge verdicts. */
export type JudgeStatus = "PASS" | "FAIL" | "SKIP" | "MOCK_PASS";

export interface CvVerdict {
  source: "cv";
  passed: boolean;
  status: JudgeStatus;
  findings_count: number;
  error_count: number;
  metrics?: Record<string, number>;
  note?: string;
}

export interface VlmVerdict {
  source: "vlm";
  passed: boolean;
  status: JudgeStatus;
  dry_run: boolean;
  summary: string;
  issues: string[];
  /** Structured schema version used for live/mock replies. */
  schema_version?: string;
  /** Parsed structured body when available. */
  structured?: {
    passed: boolean;
    summary: string;
    issues: Array<{
      code: string;
      severity: "ERROR" | "WARNING" | "INFO";
      message: string;
      region?: string;
    }>;
    scores: {
      overall: number;
      hair_naturalness?: number;
      occlusion_integrity?: number;
      face_continuity?: number;
      eye_alignment?: number;
      identity_consistency?: number;
    };
    recommendations?: string[];
  };
  scores?: {
    overall: number;
    [k: string]: number | undefined;
  };
  raw?: unknown;
  note?: string;
}

export type DualOutcome = "VALIDATED" | "REJECTED" | "NEEDS_REVIEW" | "CV_ONLY";

export interface DualJudgeResult {
  version: "0.1";
  outcome: DualOutcome;
  validated: boolean;
  cv: CvVerdict;
  vlm: VlmVerdict | null;
  policy: string;
  timestamp: string;
}
