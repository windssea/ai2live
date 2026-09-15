import { describe, it, expect } from "vitest";
import { mergeCvAndVlm, cvVerdictFromStaticQc, DUAL_JUDGE_POLICY } from "./merge.js";
import type { CvVerdict, VlmVerdict } from "./types.js";

const cvPass: CvVerdict = {
  source: "cv",
  passed: true,
  status: "PASS",
  findings_count: 1,
  error_count: 0,
};
const cvFail: CvVerdict = {
  source: "cv",
  passed: false,
  status: "FAIL",
  findings_count: 3,
  error_count: 2,
};
const vlmPass: VlmVerdict = {
  source: "vlm",
  passed: true,
  status: "MOCK_PASS",
  dry_run: true,
  summary: "mock",
  issues: [],
};
const vlmFail: VlmVerdict = {
  source: "vlm",
  passed: false,
  status: "FAIL",
  dry_run: false,
  summary: "hair unnatural",
  issues: ["hair"],
};

describe("mergeCvAndVlm", () => {
  it("VALIDATED only when both pass", () => {
    const r = mergeCvAndVlm(cvPass, vlmPass, { now: "t0" });
    expect(r.outcome).toBe("VALIDATED");
    expect(r.validated).toBe(true);
    expect(r.policy).toBe(DUAL_JUDGE_POLICY);
  });

  it("REJECTED when CV fails", () => {
    expect(mergeCvAndVlm(cvFail, vlmPass).outcome).toBe("REJECTED");
    expect(mergeCvAndVlm(cvFail, vlmFail).outcome).toBe("REJECTED");
  });

  it("NEEDS_REVIEW when CV pass but VLM fail", () => {
    const r = mergeCvAndVlm(cvPass, vlmFail);
    expect(r.outcome).toBe("NEEDS_REVIEW");
    expect(r.validated).toBe(false);
  });

  it("CV_ONLY when VLM omitted — not dual VALIDATED", () => {
    const r = mergeCvAndVlm(cvPass, null);
    expect(r.outcome).toBe("CV_ONLY");
    expect(r.validated).toBe(false);
  });

  it("cvVerdictFromStaticQc maps errors", () => {
    const v = cvVerdictFromStaticQc({
      passed: false,
      findings: [{ severity: "ERROR" }, { severity: "INFO" }],
    });
    expect(v.error_count).toBe(1);
    expect(v.passed).toBe(false);
  });
});
