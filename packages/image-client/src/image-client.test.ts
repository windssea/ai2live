import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { editImageViaProvider, segmentViaWorker } from "./index.js";

const ENV_KEYS = [
  "AI2LIVE_MODEL_DRY_RUN",
  "AI2LIVE_MODEL_PROVIDER",
  "AI2LIVE_IMAGE_WORKER_URL",
  "AI2LIVE_GROK_API_KEY",
] as const;

describe("image-client", () => {
  const saved: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-ic-"));
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("editImageViaProvider dry-run writes under previews", async () => {
    const input = path.join(dir, "in.png");
    await writeFile(input, Buffer.from("abc"));
    const r = await editImageViaProvider({
      prompt: "fix",
      inputImagePath: input,
      projectRoot: dir,
      provider: "grok",
    });
    expect(r.dryRun).toBe(true);
    const buf = await readFile(r.outputPath);
    expect(buf.toString()).toBe("abc");
  });

  it("segmentViaWorker stub without URL", async () => {
    const r = await segmentViaWorker({
      masterPath: path.join(dir, "master.png"),
      projectRoot: dir,
      labels: ["FACE"],
    });
    expect(r.masks).toHaveLength(1);
    expect(r.masks[0]!.method).toBe("stub_bbox");
  });
});
