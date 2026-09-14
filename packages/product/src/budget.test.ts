import { describe, it, expect } from "vitest";
import { createBudget, charge, BudgetExceededError, withRetry, DEFAULT_RETRY } from "./index.js";

describe("budget", () => {
  it("charges and throws when exceeded", () => {
    let b = createBudget({ max_usd: 1, max_image_calls: 2 });
    b = charge(b, "image", 0.4);
    expect(b.image_calls).toBe(1);
    expect(() => charge(b, "image", 1)).toThrow(BudgetExceededError);
  });
});

describe("retry", () => {
  it("retries retryable errors", async () => {
    let n = 0;
    const v = await withRetry(DEFAULT_RETRY, async () => {
      n++;
      if (n < 3) throw Object.assign(new Error("x"), { code: "TIMEOUT" });
      return 42;
    }, (e) => (e as { code?: string }).code ?? "UNKNOWN");
    expect(v).toBe(42);
    expect(n).toBe(3);
  });
});
