/**
 * Retry / cost / stop conditions (DESIGN §11).
 * Stop when max attempts reached OR metric improvement is flat.
 */
import type { CostBudget } from "./budget.js";
import { BudgetExceededError } from "./budget.js";

export interface StopPolicy {
  /** Max repair / generation attempts for a loop. */
  max_attempts: number;
  /** Absolute improvement below this is "flat". */
  min_metric_delta: number;
  /** Require this many consecutive flat rounds to stop. */
  flat_rounds_to_stop: number;
}

export const DEFAULT_STOP_POLICY: StopPolicy = {
  max_attempts: 3,
  min_metric_delta: 0.01,
  flat_rounds_to_stop: 2,
};

export type StopReason =
  | "continue"
  | "max_attempts"
  | "metric_flat"
  | "budget_exceeded"
  | "success";

export interface StopDecision {
  stop: boolean;
  reason: StopReason;
  attempt: number;
  last_metric?: number;
  delta?: number;
  flat_streak: number;
  note?: string;
}

export class StopConditionTracker {
  private attempt = 0;
  private lastMetric: number | undefined;
  private flatStreak = 0;
  constructor(
    public readonly policy: StopPolicy = DEFAULT_STOP_POLICY,
    public budget?: CostBudget
  ) {}

  /** Record a round metric (higher is better). Returns whether to stop. */
  record(metric: number, opts?: { success?: boolean }): StopDecision {
    this.attempt += 1;
    if (opts?.success) {
      return {
        stop: true,
        reason: "success",
        attempt: this.attempt,
        last_metric: metric,
        flat_streak: this.flatStreak,
      };
    }
    if (this.attempt >= this.policy.max_attempts) {
      return {
        stop: true,
        reason: "max_attempts",
        attempt: this.attempt,
        last_metric: metric,
        flat_streak: this.flatStreak,
        note: `Reached max_attempts=${this.policy.max_attempts}`,
      };
    }
    let delta: number | undefined;
    if (this.lastMetric != null) {
      delta = metric - this.lastMetric;
      if (Math.abs(delta) < this.policy.min_metric_delta) {
        this.flatStreak += 1;
      } else {
        this.flatStreak = 0;
      }
    }
    this.lastMetric = metric;
    if (this.flatStreak >= this.policy.flat_rounds_to_stop) {
      return {
        stop: true,
        reason: "metric_flat",
        attempt: this.attempt,
        last_metric: metric,
        delta,
        flat_streak: this.flatStreak,
        note: `Metric flat for ${this.flatStreak} rounds (min_delta=${this.policy.min_metric_delta})`,
      };
    }
    return {
      stop: false,
      reason: "continue",
      attempt: this.attempt,
      last_metric: metric,
      delta,
      flat_streak: this.flatStreak,
    };
  }

  /** Check budget without mutating. */
  checkBudget(): StopDecision | null {
    if (!this.budget) return null;
    const b = this.budget;
    if (
      b.spent_usd > b.max_usd ||
      b.image_calls > b.max_image_calls ||
      b.repair_iters > b.max_repair_iters
    ) {
      return {
        stop: true,
        reason: "budget_exceeded",
        attempt: this.attempt,
        flat_streak: this.flatStreak,
        note: "Cost budget exceeded",
      };
    }
    return null;
  }
}

export function assertWithinBudget(budget: CostBudget): void {
  if (budget.spent_usd > budget.max_usd) {
    throw new BudgetExceededError(budget, `spent_usd ${budget.spent_usd} > max ${budget.max_usd}`);
  }
  if (budget.image_calls > budget.max_image_calls) {
    throw new BudgetExceededError(budget, "image_calls exceeded");
  }
  if (budget.repair_iters > budget.max_repair_iters) {
    throw new BudgetExceededError(budget, "repair_iters exceeded");
  }
}
