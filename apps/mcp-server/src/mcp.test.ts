import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TOOLS, callTool } from "./index.js";

const ENV_KEYS = ["AI2LIVE_MODEL_DRY_RUN", "AI2LIVE_MODEL_PROVIDER"] as const;

describe("mcp tools", () => {
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

  it("lists DESIGN §8 tools including design/view/asset/layer/task", () => {
    const names = TOOLS.map((t) => t.name).sort();
    for (const required of [
      "agent_plan",
      "asset",
      "compile",
      "compose",
      "design",
      "downstream",
      "inspect",
      "layer",
      "providers",
      "revision",
      "task",
      "validate",
      "view",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("providers tool returns JSON", async () => {
    const r = await callTool("providers", {});
    expect(r.isError).toBeFalsy();
    const data = JSON.parse(r.content[0]!.text);
    expect(data.active).toBeTruthy();
    expect(Array.isArray(data.providers)).toBe(true);
  });

  it("revision list works on empty history", async () => {
    const r = await callTool("revision", {
      projectDir: "/tmp",
      action: "list",
    });
    expect(r.isError).toBeFalsy();
    const data = JSON.parse(r.content[0]!.text);
    expect(data).toHaveProperty("head");
    expect(Array.isArray(data.nodes)).toBe(true);
  });

  it("design plan_layers returns template without image", async () => {
    const r = await callTool("design", {
      projectDir: "/tmp/ai2live-mcp-design",
      action: "plan_layers",
    });
    expect(r.isError).toBeFalsy();
    const data = JSON.parse(r.content[0]!.text);
    expect(data.method).toBe("template");
    expect(Array.isArray(data.layers)).toBe(true);
    expect(data.layers.length).toBeGreaterThan(5);
  });

  it("task start/list smoke", async () => {
    const dir = `/tmp/ai2live-mcp-task-${Date.now()}`;
    const start = await callTool("task", {
      projectDir: dir,
      action: "start",
      name: "smoke",
    });
    expect(start.isError).toBeFalsy();
    const list = await callTool("task", { projectDir: dir, action: "list" });
    const data = JSON.parse(list.content[0]!.text);
    expect(data.tasks.length).toBeGreaterThanOrEqual(1);
  });
});
