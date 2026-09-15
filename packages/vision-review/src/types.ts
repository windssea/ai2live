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
