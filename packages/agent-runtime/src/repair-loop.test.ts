import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAgentContext,
  parseRepairPlan,
  runRepairClosedLoop,
} from "./index.js";

const ENV_KEYS = ["AI2LIVE_MODEL_DRY_RUN", "AI2LIVE_MODEL_PROVIDER", "AI2LIVE_GROK_API_KEY"] as const;

describe("parseRepairPlan", () => {
  it("maps recommended_repairs and suggestions", () => {
    const plan = parseRepairPlan({
      summary: "needs hair",
      suggestions: ["expand"],
      recommended_repairs: [{ type: "expand_hidden_completion", target: "FRONT_HAIR", rationale: "x" }],
    });
    expect(plan.summary).toBe("needs hair");
    expect(plan.recommended_repairs[0]!.type).toBe("expand_hidden_completion");
    expect(plan.suggestions).toEqual(["expand"]);
  });

  it("accepts action alias", () => {
    const plan = parseRepairPlan({
      recommended_repairs: [{ action: "recompile", reason: "qc failed" }],
    });
    expect(plan.recommended_repairs[0]!.type).toBe("recompile");
    expect(plan.recommended_repairs[0]!.rationale).toBe("qc failed");
  });

  it("handles non-object", () => {
    const plan = parseRepairPlan(null, "raw text");
    expect(plan.suggestions[0]).toContain("raw text");
  });
});

describe("runRepairClosedLoop dry-run", () => {
  const saved: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-repair-"));
    await mkdir(path.join(dir, "validation"), { recursive: true });
    await writeFile(
      path.join(dir, "validation", "report.json"),
      JSON.stringify({ passed: false, findings: [{ type: "PIXEL_DIFF", severity: "ERROR" }] })
    );
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("writes repair_plan.json and history", async () => {
    const ctx = createAgentContext(dir, { providerId: "grok" });
    const { plan, planPath, historyHead } = await runRepairClosedLoop(ctx, {
      applyStub: true,
      poseDiagnosis: { findings: [{ type: "POSE_GRID_OK" }] },
    });
    expect(plan.recommended_repairs.length).toBeGreaterThan(0);
    expect(plan.applied?.[0]?.status).toBe("stub_skipped");
    const written = JSON.parse(await readFile(planPath, "utf8"));
    expect(written.provider).toBe("grok");
    expect(historyHead).toBeTruthy();
    const hist = JSON.parse(await readFile(path.join(dir, "validation", "history.json"), "utf8"));
    expect(hist.nodes.some((n: { action: string }) => n.action === "repair_plan")).toBe(true);
  });
});
