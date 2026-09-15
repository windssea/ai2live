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

  it("lists expected tools", () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(["agent_plan", "compile", "providers", "validate"]);
  });

  it("providers tool returns JSON", async () => {
    const r = await callTool("providers", {});
    expect(r.isError).toBeFalsy();
    const data = JSON.parse(r.content[0]!.text);
    expect(data.active).toBeTruthy();
    expect(Array.isArray(data.providers)).toBe(true);
  });
});
