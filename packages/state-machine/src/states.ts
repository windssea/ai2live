/**
 * Project lifecycle states (DESIGN §17).
 */
export const PROJECT_STATES = [
  "NEW",
  "SPEC_READY",
  "MASTER_READY",
  "LAYER_PLAN_READY",
  "ASSET_GENERATING",
  "STATIC_QC",
  "PSD_READY",
  "RIG_BUILDING",
  "POSE_QC",
  "READY_FOR_EXPORT",
  "NEEDS_REVIEW",
  "FAILED",
  "CANCELLED",
  "REPAIRING",
] as const;

export type ProjectState = (typeof PROJECT_STATES)[number];

/** Happy-path ordered progression (excludes terminal / side states). */
export const HAPPY_PATH: readonly ProjectState[] = [
  "NEW",
  "SPEC_READY",
  "MASTER_READY",
  "LAYER_PLAN_READY",
  "ASSET_GENERATING",
  "STATIC_QC",
  "PSD_READY",
  "RIG_BUILDING",
  "POSE_QC",
  "READY_FOR_EXPORT",
] as const;

/** Side / terminal states reachable from almost anywhere. */
export const SIDE_STATES: readonly ProjectState[] = [
  "NEEDS_REVIEW",
  "FAILED",
  "CANCELLED",
  "REPAIRING",
] as const;

/**
 * Legal directed edges. REPAIRING can return to STATIC_QC or RIG_BUILDING/POSE_QC
 * depending on failure site (DESIGN §17).
 */
export const LEGAL_TRANSITIONS: Readonly<Record<ProjectState, readonly ProjectState[]>> = {
  NEW: ["SPEC_READY", "NEEDS_REVIEW", "FAILED", "CANCELLED"],
  SPEC_READY: ["MASTER_READY", "NEEDS_REVIEW", "FAILED", "CANCELLED"],
  MASTER_READY: ["LAYER_PLAN_READY", "NEEDS_REVIEW", "FAILED", "CANCELLED"],
  LAYER_PLAN_READY: ["ASSET_GENERATING", "NEEDS_REVIEW", "FAILED", "CANCELLED"],
  ASSET_GENERATING: ["STATIC_QC", "NEEDS_REVIEW", "FAILED", "CANCELLED", "REPAIRING"],
  STATIC_QC: ["PSD_READY", "REPAIRING", "NEEDS_REVIEW", "FAILED", "CANCELLED"],
  PSD_READY: ["RIG_BUILDING", "NEEDS_REVIEW", "FAILED", "CANCELLED"],
  RIG_BUILDING: ["POSE_QC", "NEEDS_REVIEW", "FAILED", "CANCELLED", "REPAIRING"],
  POSE_QC: ["READY_FOR_EXPORT", "REPAIRING", "NEEDS_REVIEW", "FAILED", "CANCELLED"],
  READY_FOR_EXPORT: ["NEEDS_REVIEW", "FAILED", "CANCELLED"],
  NEEDS_REVIEW: [
    "SPEC_READY",
    "MASTER_READY",
    "LAYER_PLAN_READY",
    "ASSET_GENERATING",
    "STATIC_QC",
    "PSD_READY",
    "RIG_BUILDING",
    "POSE_QC",
    "REPAIRING",
    "FAILED",
    "CANCELLED",
  ],
  FAILED: ["NEEDS_REVIEW", "REPAIRING", "CANCELLED", "NEW"],
  CANCELLED: ["NEW"],
  REPAIRING: [
    "STATIC_QC",
    "RIG_BUILDING",
    "POSE_QC",
    "ASSET_GENERATING",
    "NEEDS_REVIEW",
    "FAILED",
    "CANCELLED",
  ],
};

export function isProjectState(s: string): s is ProjectState {
  return (PROJECT_STATES as readonly string[]).includes(s);
}

export function canTransition(from: ProjectState, to: ProjectState): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}
