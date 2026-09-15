import { mkdir, writeFile, readFile, copyFile, access } from "node:fs/promises";
import path from "node:path";
import type { ChatCompletionResult } from "@ai2live/model-providers";
import type { AgentContext } from "./types-internal.js";

export interface RepairAction {
  type: string;
  target?: string;
  rationale?: string;
}

export interface RepairPlan {
  summary: string;
  suggestions: string[];
  recommended_repairs: RepairAction[];
  escalate_to_human?: boolean;
  source?: {
    pose_diagnosis?: unknown;
    qc_report?: unknown;
  };
  provider?: string;
  model?: string;
  dry_run_apply?: boolean;
  applied?: Array<{ type: string; status: string; note?: string; artifact?: string }>;
}

export interface RepairApplyResult {
  type: string;
  status: "applied" | "skipped" | "failed" | "stub_skipped";
  note?: string;
  artifact?: string;
}

/**
 * Parse LLM / dry-run JSON into a RepairPlan. Tolerates missing fields.
 */
export function parseRepairPlan(raw: unknown, fallbackText?: string): RepairPlan {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const repairsRaw = o.recommended_repairs;
    const repairs: RepairAction[] = Array.isArray(repairsRaw)
      ? repairsRaw.map((r) => {
          const item = r as Record<string, unknown>;
          return {
            type: String(item.type ?? item.action ?? "unknown"),
            ...(item.target ? { target: String(item.target) } : {}),
            ...(item.rationale || item.reason
              ? { rationale: String(item.rationale ?? item.reason) }
              : {}),
          };
        })
      : [];
    const suggestions = Array.isArray(o.suggestions)
      ? o.suggestions.map((s) => String(s))
      : [];
    return {
      summary: typeof o.summary === "string" ? o.summary : "Repair plan",
      suggestions,
      recommended_repairs: repairs,
      escalate_to_human: Boolean(o.escalate_to_human),
    };
  }
  return {
    summary: "LLM returned non-JSON text",
    suggestions: fallbackText ? [fallbackText.slice(0, 2000)] : [],
    recommended_repairs: [],
  };
}

export interface RepairClosedLoopOptions {
  /** Extra notes for the diagnoser. */
  userPrompt?: string;
  /** When true, record stub apply entries (does not mutate layer PNGs). */
  applyStub?: boolean;
  /**
   * When true, apply at least one deterministic repair action
   * (occlusion re-run / feather mask / recompile) then re-run static QC.
   */
  apply?: boolean;
  /** Optional pre-loaded validation summary (skips file reads). */
  validationSummary?: unknown;
  /** Optional pose diagnosis object to merge into plan.source. */
  poseDiagnosis?: unknown;
}

export interface RepairClosedLoopResult {
  plan: RepairPlan;
  planPath: string;
  result: ChatCompletionResult;
  historyHead: string | null;
  repairResultPath?: string;
  qcAfter?: unknown;
}

async function loadValidationSummary(projectRoot: string): Promise<unknown> {
  const reportPath = path.join(projectRoot, "validation", "report.json");
  try {
    return JSON.parse(await readFile(reportPath, "utf8"));
  } catch {
    /* continue */
  }
  const diagPath = path.join(projectRoot, "validation", "diagnosis.json");
  try {
    return JSON.parse(await readFile(diagPath, "utf8"));
  } catch {
    return { note: "no validation/report.json or diagnosis.json found" };
  }
}

async function persistHistory(ctx: AgentContext): Promise<void> {
  const histPath = path.join(ctx.projectRoot, "validation", "history.json");
  await mkdir(path.dirname(histPath), { recursive: true });
  await writeFile(histPath, JSON.stringify(ctx.history.toJSON(), null, 2));
}

function normalizeRepairType(type: string): string {
  return type.toLowerCase().replace(/[-_\s]+/g, "_");
}

/**
 * Apply one deterministic repair action against the project workspace.
 * Minimal but real: mutates assets / recompiles / re-QCs as appropriate.
 */
export async function applyDeterministicRepair(
  projectRoot: string,
  action: RepairAction
): Promise<RepairApplyResult> {
  const root = path.resolve(projectRoot);
  const t = normalizeRepairType(action.type);

  try {
    if (
      t.includes("occlusion") ||
      t.includes("hidden_completion") ||
      t.includes("expand_hidden") ||
      t.includes("completion")
    ) {
      const { completeOcclusionScenarios } = await import("@ai2live/occlusion");
      const r = await completeOcclusionScenarios({
        projectRoot: root,
        dryRun: true,
        forceLocalFallback: true,
      });
      // If a target layer completion exists, optionally copy onto layer path
      const faceHit = r.outputs.find((o) => o.scenario === "bangs_under_face");
      if (faceHit) {
        const manifestPath = path.join(root, "spec", "layer_manifest.json");
        try {
          const man = JSON.parse(await readFile(manifestPath, "utf8")) as {
            layers: Array<{ semantic: string; source: { asset_path?: string } }>;
          };
          const face = man.layers.find((l) => l.semantic.toUpperCase().includes("FACE"));
          if (face?.source.asset_path) {
            const dest = path.join(root, face.source.asset_path);
            // Keep original under .bak once, then overlay completion (deterministic repair)
            const bak = dest + ".pre_repair.bak";
            try {
              await access(bak);
            } catch {
              await copyFile(dest, bak);
            }
            await copyFile(path.join(root, faceHit.path), dest);
          }
        } catch {
          /* best-effort */
        }
      }
      return {
        type: action.type,
        status: "applied",
        note: `Re-ran occlusion completion (${r.outputs.length} scenarios)`,
        artifact: r.reportPath,
      };
    }

    if (t.includes("feather") || t.includes("mask")) {
      const { seeThroughFromMaster } = await import("@ai2live/segmentation");
      const r = await seeThroughFromMaster({
        projectRoot: root,
        feather: 3,
        splitBilateral: true,
        debug: false,
      });
      return {
        type: action.type,
        status: "applied",
        note: `Re-ran see-through segment with feather=3 (masks=${r.masks.length})`,
        artifact: r.reportPath,
      };
    }

    if (t.includes("recompile") || t.includes("compile") || t.includes("psd")) {
      const { compilePsd } = await import("@ai2live/psd-compiler");
      const compiled = await compilePsd({ projectRoot: root });
      return {
        type: action.type,
        status: "applied",
        note: "Recompiled PSD + Gate 6 round-trip",
        artifact: compiled.psdPath,
      };
    }

    // Default deterministic action: re-run occlusion (always does something real)
    const { completeOcclusionScenarios } = await import("@ai2live/occlusion");
    const r = await completeOcclusionScenarios({
      projectRoot: root,
      dryRun: true,
      forceLocalFallback: true,
    });
    return {
      type: action.type,
      status: "applied",
      note: `Default apply: occlusion re-run for unrecognized type "${action.type}"`,
      artifact: r.reportPath,
    };
  } catch (err) {
    return {
      type: action.type,
      status: "failed",
      note: (err as Error).message,
    };
  }
}

/**
 * Closed loop: gather QC/pose diagnosis → LLM repair plan → write repair_plan.json
 * → append history revision → optional stub apply OR real --apply mutation + re-QC.
 */
export async function runRepairClosedLoop(
  ctx: AgentContext,
  opts: RepairClosedLoopOptions = {}
): Promise<RepairClosedLoopResult> {
  const validationSummary =
    opts.validationSummary ?? (await loadValidationSummary(ctx.projectRoot));

  const system = [
    "You are the ai2live diagnosis agent.",
    "Given a validation/QC summary, suggest repair actions as JSON only:",
    '{ "summary": string, "suggestions": string[], "recommended_repairs": [ { "type": string, "target"?: string, "rationale"?: string } ], "escalate_to_human"?: boolean }.',
    "Prefer deterministic tools: expand_hidden_completion, feather_mask, recompile.",
  ].join(" ");

  const user = [
    `Project: ${ctx.projectRoot}`,
    `Provider: ${ctx.provider.id}`,
    "Validation summary:",
    typeof validationSummary === "string"
      ? validationSummary
      : JSON.stringify(validationSummary, null, 2),
    opts.userPrompt ? `Notes:\n${opts.userPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await ctx.provider.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    response_format: "json",
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    parsed = {
      summary: "LLM returned non-JSON text",
      suggestions: [result.text.slice(0, 2000)],
      recommended_repairs: [],
      raw_text: result.text,
    };
  }

  const plan = parseRepairPlan(parsed, result.text);
  plan.provider = result.provider;
  plan.model = result.model;
  plan.source = {
    qc_report: validationSummary,
    ...(opts.poseDiagnosis ? { pose_diagnosis: opts.poseDiagnosis } : {}),
  };

  // Ensure at least one recommended repair so --apply always has work
  if (plan.recommended_repairs.length === 0) {
    plan.recommended_repairs.push({
      type: "expand_hidden_completion",
      target: "FACE",
      rationale: "Default deterministic repair when planner returned empty list",
    });
  }

  const planPath = path.join(ctx.projectRoot, "validation", "repair_plan.json");
  await mkdir(path.dirname(planPath), { recursive: true });

  const headBefore = ctx.history.getHead();
  const planNode = ctx.history.append({
    expected_head: headBefore,
    action: "repair_plan",
    target: "validation/repair_plan.json",
    message: `LLM repair plan via ${result.provider}`,
    payload: {
      provider: result.provider,
      model: result.model,
      repair_count: plan.recommended_repairs.length,
      apply: Boolean(opts.apply),
      apply_stub: Boolean(opts.applyStub),
    },
    seed: `repair-plan-${ctx.projectRoot}-${result.provider}-${plan.recommended_repairs.length}`,
  });

  let qcAfter: unknown;
  let repairResultPath: string | undefined;
  const applied: RepairApplyResult[] = [];

  if (opts.applyStub && !opts.apply) {
    plan.dry_run_apply = true;
    plan.applied = plan.recommended_repairs.map((r) => ({
      type: r.type,
      status: "stub_skipped",
      note: "Stub apply only — no layer PNG mutation",
    }));
  } else if (opts.apply) {
    // Apply first recommended repair (minimal closed loop), then recompile + QC
    const primary = plan.recommended_repairs[0]!;
    const beforeSnapshot = {
      qc: validationSummary,
      timestamp: new Date().toISOString(),
    };

    const applyResult = await applyDeterministicRepair(ctx.projectRoot, primary);
    applied.push(applyResult);

    // Always recompile after a successful apply so PSD reflects mutations
    if (applyResult.status === "applied" && !normalizeRepairType(primary.type).includes("recompile")) {
      const recomp = await applyDeterministicRepair(ctx.projectRoot, {
        type: "recompile",
        rationale: "Post-repair PSD refresh",
      });
      applied.push(recomp);
    }

    let qcReport: unknown = null;
    try {
      const { runStaticQc } = await import("@ai2live/qc-engine");
      qcReport = await runStaticQc({ projectRoot: ctx.projectRoot });
      qcAfter = qcReport;
    } catch (err) {
      qcAfter = { error: (err as Error).message };
    }

    plan.applied = applied.map((a) => ({
      type: a.type,
      status: a.status,
      note: a.note,
      artifact: a.artifact,
    }));

    const repairResult = {
      version: "0.1",
      applied_at: new Date().toISOString(),
      primary_action: primary,
      applied,
      before: beforeSnapshot,
      after: { qc: qcAfter },
      history_before: headBefore,
      history_plan: planNode.id,
    };
    repairResultPath = path.join(ctx.projectRoot, "validation", "repair_result.json");
    await writeFile(repairResultPath, JSON.stringify(repairResult, null, 2));

    ctx.history.append({
      expected_head: planNode.id,
      action: "repair_apply",
      target: "validation/repair_result.json",
      message: `Applied ${primary.type} → ${applyResult.status}`,
      payload: {
        primary: primary.type,
        status: applyResult.status,
        applied_count: applied.length,
      },
      seed: `repair-apply-${ctx.projectRoot}-${primary.type}-${applyResult.status}`,
    });

    if (qcReport) {
      ctx.history.append({
        expected_head: ctx.history.getHead(),
        action: "validate",
        target: "validation/report.json",
        message: "Static QC after repair apply",
        payload: {
          passed: (qcReport as { passed?: boolean }).passed ?? null,
        },
        seed: `repair-qc-${ctx.projectRoot}`,
      });
    }
  }

  await writeFile(planPath, JSON.stringify(plan, null, 2));
  await persistHistory(ctx);

  return {
    plan,
    planPath,
    result,
    historyHead: ctx.history.getHead(),
    repairResultPath,
    qcAfter,
  };
}
