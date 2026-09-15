
import { describe, it, expect } from "vitest";
import { StopConditionTracker, DEFAULT_STOP_POLICY } from "./stop-conditions.js";

describe("StopConditionTracker", () => {
  it("stops at max_attempts", () => {
    const t = new StopConditionTracker({ ...DEFAULT_STOP_POLICY, max_attempts: 2 });
    expect(t.record(0.5).stop).toBe(false);
    expect(t.record(0.6).reason).toBe("max_attempts");
  });

  it("stops when metric flat", () => {
    const t = new StopConditionTracker({
      max_attempts: 10,
      min_metric_delta: 0.05,
      flat_rounds_to_stop: 2,
    });
    expect(t.record(0.5).stop).toBe(false);
    expect(t.record(0.51).stop).toBe(false); // first flat
    const d = t.record(0.52);
    expect(d.stop).toBe(true);
    expect(d.reason).toBe("metric_flat");
  });

  it("success stops early", () => {
    const t = new StopConditionTracker();
    expect(t.record(1, { success: true }).reason).toBe("success");
  });
});
