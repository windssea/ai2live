import type { CvVerdict, DualJudgeResult, DualOutcome, VlmVerdict } from "./types.js";

/**
 * Dry-run policy (documented):
 * - VLM review in dry-run returns structured MOCK_PASS (passed=true) so offline CI can
 *   exercise the merge path without calling a real vision model.
 * - VALIDATED still requires BOTH CV pass AND VLM pass (mock counts as pass).
 * - If VLM is omitted (flag off), outcome is CV_ONLY and validated mirrors CV only.
 */
export const DUAL_JUDGE_POLICY =
  "VALIDATED only if CV pass AND VLM pass; dry-run VLM yields MOCK_PASS (counts as pass); " +
  "without VLM → CV_ONLY (not VALIDATED dual-judge).";

export function mergeCvAndVlm(
  cv: CvVerdict,
  vlm: VlmVerdict | null,
  opts?: { now?: string }
): DualJudgeResult {
  let outcome: DualOutcome;
  let validated: boolean;

  if (!vlm) {
    outcome = "CV_ONLY";
    validated = false; // dual-judge VALIDATED requires both
  } else if (cv.passed && vlm.passed) {
    outcome = "VALIDATED";
    validated = true;
  } else if (!cv.passed && !vlm.passed) {
    outcome = "REJECTED";
    validated = false;
  } else if (!cv.passed) {
    outcome = "REJECTED";
    validated = false;
  } else {
    // CV pass, VLM fail
    outcome = "NEEDS_REVIEW";
    validated = false;
  }

  return {
    version: "0.1",
    outcome,
    validated,
    cv,
    vlm,
    policy: DUAL_JUDGE_POLICY,
    timestamp: opts?.now ?? new Date().toISOString(),
  };
}

export function cvVerdictFromStaticQc(report: {
  passed: boolean;
  findings?: Array<{ severity?: string }>;
  metrics?: Record<string, number>;
}): CvVerdict {
  const findings = report.findings ?? [];
  const error_count = findings.filter((f) => f.severity === "ERROR").length;
  return {
    source: "cv",
    passed: Boolean(report.passed),
    status: report.passed ? "PASS" : "FAIL",
    findings_count: findings.length,
    error_count,
    metrics: report.metrics,
    note: "Deterministic CV / static QC",
  };
}

export function cvVerdictFromPoseFindings(findings: Array<{ severity?: string }>): CvVerdict {
  const error_count = findings.filter((f) => f.severity === "ERROR").length;
  const passed = error_count === 0;
  return {
    source: "cv",
    passed,
    status: passed ? "PASS" : "FAIL",
    findings_count: findings.length,
    error_count,
    note: "Pose QA heuristic / contract findings",
  };
}
