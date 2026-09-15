import { HistoryStore } from "@ai2live/history";
import { createBudget, type CostBudget } from "@ai2live/product";
import {
  createProvider,
  resolveProviderId,
  type ModelProvider,
  type ProviderId,
  type ChatCompletionResult,
} from "@ai2live/model-providers";

export interface AgentContext {
  projectRoot: string;
  history: HistoryStore;
  budget: CostBudget;
  /** Pluggable LLM / local Codex provider (planning & diagnosis only). */
  provider: ModelProvider;
}

export interface CreateAgentContextOptions {
  providerId?: ProviderId | string;
  provider?: ModelProvider;
}

export function createAgentContext(
  projectRoot: string,
  opts: CreateAgentContextOptions = {}
): AgentContext {
  const provider =
    opts.provider ??
    createProvider(opts.providerId ?? resolveProviderId(), { cwd: projectRoot });
  return {
    projectRoot,
    history: new HistoryStore(),
    budget: createBudget(),
    provider,
  };
}

export type AgentPhase =
  | "inspect"
  | "design"
  | "segment"
  | "occlusion"
  | "expression"
  | "compile"
  | "validate"
  | "repair"
  | "downstream"
  | "handoff";

export interface AgentPlanStep {
  phase: AgentPhase;
  tool: string;
  args?: Record<string, unknown>;
}

/** High-level default plan covering M0–M6 tools. */
export function defaultUnattendedPlan(): AgentPlanStep[] {
  return [
    { phase: "inspect", tool: "validate_schemas" },
    { phase: "segment", tool: "see_through" },
    { phase: "occlusion", tool: "complete_three_scenarios" },
    { phase: "expression", tool: "differentials" },
    { phase: "compile", tool: "compile_psd" },
    { phase: "validate", tool: "static_qc" },
    { phase: "repair", tool: "pose_grid_diagnose" },
    { phase: "downstream", tool: "autolive2d_package" },
    { phase: "downstream", tool: "psd2live_deep_session" },
  ];
}

export interface PlannerChatOptions {
  /** Extra user context (project summary, goals). */
  userPrompt?: string;
  /** Seed plan to augment. */
  basePlan?: AgentPlanStep[];
  temperature?: number;
}

/**
 * Ask the configured provider for a strategy/plan JSON.
 * Deterministic tools (compile/qc/…) stay as code paths — LLM only plans/diagnoses text.
 */
export async function runPlannerChat(
  ctx: AgentContext,
  opts: PlannerChatOptions = {}
): Promise<{ result: ChatCompletionResult; plan: AgentPlanStep[]; parsed: unknown }> {
  const base = opts.basePlan ?? defaultUnattendedPlan();
  const system = [
    "You are the ai2live planning agent.",
    "Agent = strategy; programs = geometry. Prefer deterministic tools for compile/QC/hashes.",
    "Respond with JSON only: { \"plan_steps\": [ { \"phase\": string, \"tool\": string, \"args\"?: object } ], \"notes\"?: string }.",
    "Phases: inspect, design, segment, occlusion, expression, compile, validate, repair, downstream, handoff.",
  ].join(" ");

  const user = [
    `Project: ${ctx.projectRoot}`,
    `Provider: ${ctx.provider.id}`,
    "Base plan:",
    JSON.stringify(base, null, 2),
    opts.userPrompt ? `User goals:\n${opts.userPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await ctx.provider.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: opts.temperature ?? 0.2,
    response_format: "json",
  });

  let parsed: unknown = null;
  let plan = base;
  try {
    parsed = JSON.parse(result.text);
    const steps = (parsed as { plan_steps?: AgentPlanStep[] }).plan_steps;
    if (Array.isArray(steps) && steps.length > 0) {
      plan = steps.map((s) => ({
        phase: s.phase,
        tool: String(s.tool),
        ...(s.args ? { args: s.args } : {}),
      }));
    }
  } catch {
    parsed = { raw_text: result.text };
  }

  return { result, plan, parsed };
}

export interface DiagnoseChatOptions {
  validationSummary: unknown;
  userPrompt?: string;
  temperature?: number;
}

/**
 * Feed a validation report summary to the LLM for repair suggestions.
 */
export async function runDiagnoseChat(
  ctx: AgentContext,
  opts: DiagnoseChatOptions
): Promise<{ result: ChatCompletionResult; parsed: unknown }> {
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
    typeof opts.validationSummary === "string"
      ? opts.validationSummary
      : JSON.stringify(opts.validationSummary, null, 2),
    opts.userPrompt ? `Notes:\n${opts.userPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await ctx.provider.chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: opts.temperature ?? 0.2,
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

  return { result, parsed };
}

/** Alias used by some call sites / docs. */
export const runAgentStep = runPlannerChat;

export type { ModelProvider, ProviderId, ChatCompletionResult };
