import { mkdir, writeFile, readFile } from "node:fs/promises";
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
  applied?: Array<{ type: string; status: string; note?: string }>;
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

/**
 * Closed loop: gather QC/pose diagnosis → LLM repair plan → write repair_plan.json
 * → append history revision → optional stub apply markers.
 *
 * Calls the provider directly (same schema as runDiagnoseChat) to avoid import cycles.
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
    "Do not invent pixel edits — point at deterministic tools (recompile, pose grid, occlusion stubs).",
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

  if (opts.applyStub) {
    plan.dry_run_apply = true;
    plan.applied = plan.recommended_repairs.map((r) => ({
      type: r.type,
      status: "stub_skipped",
      note: "Stub apply only — no layer PNG mutation",
    }));
  }

  const planPath = path.join(ctx.projectRoot, "validation", "repair_plan.json");
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, JSON.stringify(plan, null, 2));

  const head = ctx.history.getHead();
  const node = ctx.history.append({
    expected_head: head,
    action: "repair_plan",
    target: "validation/repair_plan.json",
    message: `LLM repair plan via ${result.provider}`,
    payload: {
      provider: result.provider,
      model: result.model,
      repair_count: plan.recommended_repairs.length,
      apply_stub: Boolean(opts.applyStub),
    },
    seed: `repair-plan-${ctx.projectRoot}-${result.provider}-${plan.recommended_repairs.length}`,
  });
  await persistHistory(ctx);

  return {
    plan,
    planPath,
    result,
    historyHead: node.id,
  };
}
