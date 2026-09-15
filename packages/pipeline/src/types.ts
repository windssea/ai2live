export type ProviderChoice = "grok" | "openai" | "codex";

export type StepId =
  | "bootstrap"
  | "doctor"
  | "segment"
  | "occlusion"
  | "expressions"
  | "compile"
  | "qc"
  | "pose"
  | "repair"
  | "downstream"
  | "report";

export const PIPELINE_STEPS: StepId[] = [
  "bootstrap",
  "doctor",
  "segment",
  "occlusion",
  "expressions",
  "compile",
  "qc",
  "pose",
  "repair",
  "downstream",
  "report",
];

export type PipelineEventType = "step_start" | "step_end" | "log" | "error" | "done";

export interface PipelineEvent {
  type: PipelineEventType;
  step?: StepId;
  message?: string;
  data?: unknown;
}

export interface StepRecord {
  id: StepId;
  status: "ok" | "fail" | "skip" | "warn";
  startedAt: string;
  endedAt?: string;
  message?: string;
  data?: unknown;
}

export interface PipelineResult {
  projectRoot: string;
  passed: boolean;
  dryRun: boolean;
  provider: string;
  steps: StepRecord[];
  reportPath: string;
  artifacts: Record<string, string | undefined>;
  qcPassed?: boolean;
  handoffPath?: string;
}

export interface RunFullPipelineOptions {
  projectRoot: string;
  provider?: ProviderChoice;
  dryRun?: boolean;
  /** Skip individual steps (bootstrap skipped unless fromImage is set). `compile` is never skippable. */
  skip?: Partial<Record<StepId, boolean>>;
  onEvent?: (e: PipelineEvent) => void;
  signal?: AbortSignal;
  /** When set, bootstrap project from a single character design image first. */
  fromImage?: string;
  /** Character display name when bootstrapping. */
  characterName?: string;
  /** Segment options */
  feather?: number;
  splitBilateral?: boolean;
  segmentDebug?: boolean;
  /** Always run agent repair even if QC passed (default: only when QC failed). */
  alwaysRepair?: boolean;
}
