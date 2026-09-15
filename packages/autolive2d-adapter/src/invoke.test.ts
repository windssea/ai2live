import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { invokeAutoLive2dSmoke } from "./invoke.js";

describe("invokeAutoLive2dSmoke mock-first", () => {
  let dir: string;
  const prev = { ...process.env };
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "al-invoke-"));
    await mkdir(path.join(dir, "builds", "autolive2d"), { recursive: true });
    delete process.env.AI2LIVE_AUTOLIVE2D_CMD;
    delete process.env.AI2LIVE_AUTOLIVE2D_BIN;
    process.env.AI2LIVE_USE_MOCK_RIG = "1";
  });
  afterEach(async () => {
    process.env = { ...prev };
    await rm(dir, { recursive: true, force: true });
  });

  it("produces invoke_result.json via mock (not skipped)", async () => {
    const pkg = path.join(dir, "builds", "autolive2d");
    const r = await invokeAutoLive2dSmoke({ projectRoot: dir, packageDir: pkg });
    expect(r.skipped).toBe(false);
    expect(r.attempted).toBe(true);
    await access(path.join(pkg, "invoke_result.json"));
    await access(path.join(pkg, "invoke_log.json"));
    const result = JSON.parse(await readFile(path.join(pkg, "invoke_result.json"), "utf8"));
    expect(result.via).toBe("mock_rig");
    expect(result.ok).toBe(true);
  }, 30_000);
});
