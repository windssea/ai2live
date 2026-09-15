import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { invokePsd2LiveSmoke } from "./invoke.js";

describe("invokePsd2LiveSmoke mock-first", () => {
  let dir: string;
  const prev = { ...process.env };
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "p2l-invoke-"));
    await mkdir(path.join(dir, "builds", "psd2live"), { recursive: true });
    delete process.env.AI2LIVE_PSD2LIVE_CMD;
    delete process.env.AI2LIVE_PSD2LIVE_BIN;
    delete process.env.AI2LIVE_PSD2LIVE_MCP_URL;
    process.env.AI2LIVE_USE_MOCK_RIG = "1";
  });
  afterEach(async () => {
    process.env = { ...prev };
    await rm(dir, { recursive: true, force: true });
  });

  it("produces invoke_result.json via mock (not skipped)", async () => {
    const pkg = path.join(dir, "builds", "psd2live");
    const r = await invokePsd2LiveSmoke({ projectRoot: dir, packageDir: pkg });
    expect(r.skipped).toBe(false);
    expect(r.attempted).toBe(true);
    await access(path.join(pkg, "invoke_result.json"));
    const result = JSON.parse(await readFile(path.join(pkg, "invoke_result.json"), "utf8"));
    expect(result.via).toBe("mock_rig");
    expect(result.ok).toBe(true);
  }, 30_000);
});
