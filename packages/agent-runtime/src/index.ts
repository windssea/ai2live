import { HistoryStore } from "@ai2live/history";
import { createBudget, type CostBudget } from "@ai2live/product";

export interface AgentContext {
  projectRoot: string;
  history: HistoryStore;
  budget: CostBudget;
}

export function createAgentContext(projectRoot: string): AgentContext {
  return {
    projectRoot,
    history: new HistoryStore(),
    budget: createBudget(),
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
