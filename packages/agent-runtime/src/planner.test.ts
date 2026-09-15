import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAgentContext, runPlannerChat, runDiagnoseChat, defaultUnattendedPlan } from "./index.js";

const ENV_KEYS = ["AI2LIVE_MODEL_DRY_RUN", "AI2LIVE_MODEL_PROVIDER", "AI2LIVE_GROK_API_KEY", "XAI_API_KEY"] as const;

describe("agent-runtime provider wiring", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("createAgentContext attaches default grok provider", () => {
    const ctx = createAgentContext("/tmp/proj");
    expect(ctx.provider.id).toBe("grok");
  });

  it("runPlannerChat returns plan from dry-run json", async () => {
    const ctx = createAgentContext("/tmp/proj", { providerId: "grok" });
    const { plan, result, parsed } = await runPlannerChat(ctx);
    expect(result.provider).toBe("grok");
    expect(plan.length).toBeGreaterThan(0);
    expect(parsed).toBeTruthy();
  });

  it("runDiagnoseChat writes structured suggestions", async () => {
    const ctx = createAgentContext("/tmp/proj", { providerId: "openai" });
    const { parsed, result } = await runDiagnoseChat(ctx, {
      validationSummary: { passed: false, findings: [{ type: "PIXEL_DIFF", severity: "ERROR" }] },
    });
    expect(result.provider).toBe("openai");
    expect(parsed).toBeTruthy();
  });

  it("defaultUnattendedPlan still deterministic", () => {
    expect(defaultUnattendedPlan().some((s) => s.tool === "compile_psd")).toBe(true);
  });
});
