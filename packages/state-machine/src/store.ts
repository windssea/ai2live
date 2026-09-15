import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canTransition,
  isProjectState,
  type ProjectState,
} from "./states.js";

export const STATE_REL_PATH = path.posix.join(".ai2live", "state.json");

export interface StateRecord {
  version: "0.1";
  state: ProjectState;
  updated_at: string;
  history: Array<{
    from: ProjectState;
    to: ProjectState;
    at: string;
    reason?: string;
    step?: string;
  }>;
}

export class IllegalTransitionError extends Error {
  readonly code = "ILLEGAL_TRANSITION" as const;
  constructor(
    public readonly from: ProjectState,
    public readonly to: ProjectState
  ) {
    super(`Illegal transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function createInitialState(now = new Date().toISOString()): StateRecord {
  return {
    version: "0.1",
    state: "NEW",
    updated_at: now,
    history: [],
  };
}

export async function loadProjectState(projectRoot: string): Promise<StateRecord> {
  const abs = path.join(projectRoot, STATE_REL_PATH);
  try {
    const raw = JSON.parse(await readFile(abs, "utf8")) as Partial<StateRecord>;
    if (raw && typeof raw.state === "string" && isProjectState(raw.state)) {
      return {
        version: "0.1",
        state: raw.state,
        updated_at: typeof raw.updated_at === "string" ? raw.updated_at : new Date().toISOString(),
        history: Array.isArray(raw.history) ? raw.history : [],
      };
    }
  } catch {
    /* missing → NEW */
  }
  return createInitialState();
}

export async function saveProjectState(
  projectRoot: string,
  record: StateRecord
): Promise<string> {
  const abs = path.join(projectRoot, STATE_REL_PATH);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(record, null, 2) + "\n");
  return abs;
}

export function advanceStateInMemory(
  record: StateRecord,
  to: ProjectState,
  opts?: { reason?: string; step?: string; force?: boolean; now?: string }
): StateRecord {
  const from = record.state;
  if (!opts?.force && !canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
  const at = opts?.now ?? new Date().toISOString();
  if (from === to) {
    return { ...record, updated_at: at };
  }
  return {
    version: "0.1",
    state: to,
    updated_at: at,
    history: [
      ...record.history,
      {
        from,
        to,
        at,
        ...(opts?.reason ? { reason: opts.reason } : {}),
        ...(opts?.step ? { step: opts.step } : {}),
      },
    ],
  };
}

export async function advanceProjectState(
  projectRoot: string,
  to: ProjectState,
  opts?: { reason?: string; step?: string; force?: boolean }
): Promise<StateRecord> {
  const current = await loadProjectState(projectRoot);
  const next = advanceStateInMemory(current, to, opts);
  await saveProjectState(projectRoot, next);
  return next;
}

/** Map pipeline step ids → target state after a successful step. */
export const STEP_SUCCESS_STATE: Record<string, ProjectState> = {
  bootstrap: "MASTER_READY",
  doctor: "NEW", // no-op advancement preference handled by caller
  segment: "LAYER_PLAN_READY",
  occlusion: "ASSET_GENERATING",
  expressions: "ASSET_GENERATING",
  compile: "PSD_READY",
  qc: "STATIC_QC",
  pose: "POSE_QC",
  repair: "REPAIRING",
  downstream: "RIG_BUILDING",
  report: "READY_FOR_EXPORT",
};

/**
 * Advance toward a target along the happy path when legal; otherwise try direct edge;
 * on QC fail → REPAIRING; on hard fail → FAILED.
 */
export async function advanceFromPipelineStep(
  projectRoot: string,
  step: string,
  outcome: "ok" | "fail" | "skip" | "warn",
  opts?: { qcPassed?: boolean }
): Promise<StateRecord | null> {
  if (outcome === "skip") return null;

  const current = await loadProjectState(projectRoot);
  let target: ProjectState | undefined;

  if (outcome === "fail") {
    target = "FAILED";
  } else if (step === "qc" && opts?.qcPassed === false) {
    target = "REPAIRING";
  } else if (step === "qc" && opts?.qcPassed === true) {
    // STATIC_QC then typically compile already ran — prefer PSD_READY if compile done
    target = current.state === "PSD_READY" || current.state === "STATIC_QC" ? "PSD_READY" : "STATIC_QC";
    // After compile→PSD_READY, qc success should stay PSD_READY or move toward RIG
    if (current.state === "PSD_READY") target = "PSD_READY";
    else if (canTransition(current.state, "STATIC_QC")) target = "STATIC_QC";
    else if (canTransition(current.state, "PSD_READY")) target = "PSD_READY";
  } else if (step === "pose" && outcome === "ok") {
    target = "POSE_QC";
  } else if (step === "downstream" && outcome === "ok") {
    target = canTransition(current.state, "READY_FOR_EXPORT")
      ? "READY_FOR_EXPORT"
      : "RIG_BUILDING";
  } else if (step === "report" && outcome === "ok") {
    target = "READY_FOR_EXPORT";
  } else if (step === "repair") {
    target = outcome === "ok" ? "REPAIRING" : "FAILED";
  } else {
    target = STEP_SUCCESS_STATE[step];
  }

  if (!target || target === current.state) {
    // Try walking happy-path forward for early steps
    if (step === "bootstrap" && outcome === "ok") {
      return walkHappyPath(projectRoot, current, ["SPEC_READY", "MASTER_READY"], step);
    }
    if (step === "segment" && outcome === "ok") {
      return walkHappyPath(
        projectRoot,
        current,
        ["SPEC_READY", "MASTER_READY", "LAYER_PLAN_READY"],
        step
      );
    }
    if (!target || target === current.state) {
      await saveProjectState(projectRoot, current);
      return current;
    }
  }

  // Walk intermediate happy-path states when jumping ahead
  const walked = await walkToward(projectRoot, current, target, step);
  return walked;
}

async function walkHappyPath(
  projectRoot: string,
  current: StateRecord,
  targets: ProjectState[],
  step: string
): Promise<StateRecord> {
  let rec = current;
  for (const t of targets) {
    if (rec.state === t) continue;
    if (canTransition(rec.state, t)) {
      rec = advanceStateInMemory(rec, t, { step, reason: `pipeline:${step}` });
    }
  }
  await saveProjectState(projectRoot, rec);
  return rec;
}

async function walkToward(
  projectRoot: string,
  current: StateRecord,
  target: ProjectState,
  step: string
): Promise<StateRecord> {
  let rec = current;
  if (canTransition(rec.state, target)) {
    rec = advanceStateInMemory(rec, target, { step, reason: `pipeline:${step}` });
    await saveProjectState(projectRoot, rec);
    return rec;
  }
  // force only for FAILED/CANCELLED/NEEDS_REVIEW/REPAIRING from anywhere already in LEGAL
  if (canTransition(rec.state, target)) {
    /* unreachable */
  }
  // Try progressive happy-path steps until target or stuck
  const happy = [
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
  ] as ProjectState[];
  const ti = happy.indexOf(target);
  const ci = happy.indexOf(rec.state);
  if (ti >= 0 && ci >= 0 && ti > ci) {
    for (let i = ci + 1; i <= ti; i++) {
      const next = happy[i]!;
      if (canTransition(rec.state, next)) {
        rec = advanceStateInMemory(rec, next, { step, reason: `pipeline:${step}` });
      } else break;
    }
    await saveProjectState(projectRoot, rec);
    return rec;
  }
  // Side transitions that are legal
  if (canTransition(rec.state, target)) {
    rec = advanceStateInMemory(rec, target, { step, reason: `pipeline:${step}` });
  }
  await saveProjectState(projectRoot, rec);
  return rec;
}

export function formatStatus(record: StateRecord): string {
  const last = record.history[record.history.length - 1];
  const lines = [
    `state=${record.state}`,
    `updated_at=${record.updated_at}`,
    `transitions=${record.history.length}`,
  ];
  if (last) lines.push(`last=${last.from}→${last.to}${last.step ? ` (${last.step})` : ""}`);
  return lines.join("\n");
}
