import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cvVerdictFromPoseFindings,
  cvVerdictFromStaticQc,
  mergeCvAndVlm,
} from "./merge.js";
import type { CvVerdict, DualJudgeResult } from "./types.js";
import { runVlmReview } from "./vlm-review.js";

export interface DualJudgeOptions {
  projectRoot: string;
  /** CV side — static QC report and/or pose findings. */
  cvReport?: {
    passed: boolean;
    findings?: Array<{ severity?: string }>;
    metrics?: Record<string, number>;
  };
  poseFindings?: Array<{ severity?: string }>;
  dryRun?: boolean;
  provider?: string;
  context?: string;
  writeReport?: boolean;
}

/**
 * Combine deterministic CV + optional VLM → VALIDATED only if both pass.
 */
export async function runDualJudge(opts: DualJudgeOptions): Promise<DualJudgeResult> {
  const root = path.resolve(opts.projectRoot);
  let cv: CvVerdict;
  if (opts.cvReport) {
    cv = cvVerdictFromStaticQc(opts.cvReport);
  } else if (opts.poseFindings) {
    cv = cvVerdictFromPoseFindings(opts.poseFindings);
  } else {
    cv = {
      source: "cv",
      passed: true,
      status: "SKIP",
      findings_count: 0,
      error_count: 0,
      note: "No CV report supplied — treated as pass/skip",
    };
  }

  const vlm = await runVlmReview({
    projectRoot: root,
    dryRun: opts.dryRun,
    provider: opts.provider,
    context: opts.context,
    writeReport: opts.writeReport,
  });

  const result = mergeCvAndVlm(cv, vlm);
  if (opts.writeReport !== false) {
    const dir = path.join(root, "validation");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "dual_judge.json"), JSON.stringify(result, null, 2) + "\n");
  }
  return result;
}
