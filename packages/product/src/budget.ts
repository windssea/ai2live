export interface CostBudget {
  max_usd: number;
  max_image_calls: number;
  max_repair_iters: number;
  spent_usd: number;
  image_calls: number;
  repair_iters: number;
}

export class BudgetExceededError extends Error {
  readonly code = "BUDGET_EXCEEDED" as const;
  constructor(public readonly budget: CostBudget, public readonly reason: string) {
    super(`BUDGET_EXCEEDED: ${reason}`);
    this.name = "BudgetExceededError";
  }
}

export function createBudget(partial?: Partial<CostBudget>): CostBudget {
  return {
    max_usd: partial?.max_usd ?? 5,
    max_image_calls: partial?.max_image_calls ?? 40,
    max_repair_iters: partial?.max_repair_iters ?? 5,
    spent_usd: 0,
    image_calls: 0,
    repair_iters: 0,
  };
}

export function charge(
  budget: CostBudget,
  kind: "image" | "repair" | "llm",
  usd: number
): CostBudget {
  const next = { ...budget };
  next.spent_usd += usd;
  if (kind === "image") next.image_calls += 1;
  if (kind === "repair") next.repair_iters += 1;
  if (next.spent_usd > next.max_usd) {
    throw new BudgetExceededError(next, `spent_usd ${next.spent_usd} > max ${next.max_usd}`);
  }
  if (next.image_calls > next.max_image_calls) {
    throw new BudgetExceededError(next, `image_calls exceeded`);
  }
  if (next.repair_iters > next.max_repair_iters) {
    throw new BudgetExceededError(next, `repair_iters exceeded`);
  }
  return next;
}
