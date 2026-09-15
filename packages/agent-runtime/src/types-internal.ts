import type { HistoryStore } from "@ai2live/history";
import type { CostBudget } from "@ai2live/product";
import type { ModelProvider } from "@ai2live/model-providers";

export interface AgentContext {
  projectRoot: string;
  history: HistoryStore;
  budget: CostBudget;
  provider: ModelProvider;
}
