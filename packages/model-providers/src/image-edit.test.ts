import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createProvider,
  dryRunImageEdit,
  TINY_PNG,
  resolveImageOutputPath,
} from "./index.js";

const ENV_KEYS = [
  "AI2LIVE_MODEL_DRY_RUN",
  "AI2LIVE_GROK_API_KEY",
  "XAI_API_KEY",
  "AI2LIVE_OPENAI_API_KEY",
  "OPENAI_API_KEY",
] as const;

describe("dryRunImageEdit", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-img-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes tiny png when no input", async () => {
    const out = path.join(dir, "previews", "out.png");
    const r = await dryRunImageEdit({ prompt: "test", outputPath: out });
    expect(r.dryRun).toBe(true);
    expect(r.method).toBe("dry_run_png");
    const buf = await readFile(r.outputPath);
    expect(buf.equals(TINY_PNG)).toBe(true);
  });

  it("copies input when present", async () => {
    const input = path.join(dir, "in.png");
    await writeFile(input, Buffer.from("png-bytes"));
    const out = path.join(dir, "out.png");
    const r = await dryRunImageEdit({ prompt: "x", inputImagePath: input, outputPath: out });
    expect(r.method).toBe("dry_run_copy");
    expect(await readFile(out, "utf8")).toBe("png-bytes");
  });

  it("resolveImageOutputPath defaults under previews/", () => {
    const p = resolveImageOutputPath({ prompt: "x", projectRoot: dir });
    expect(p.startsWith(path.join(dir, "previews"))).toBe(true);
  });
});

describe("provider imageEdit dry-run", () => {
  const saved: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-prov-img-"));
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("grok imageEdit dry-run", async () => {
    const p = createProvider("grok");
    const out = path.join(dir, "previews", "g.png");
    const r = await p.imageEdit!({ prompt: "fix hair", outputPath: out, projectRoot: dir });
    expect(r.outputPath).toBe(out);
    expect(r.dryRun).toBe(true);
  });

  it("openai imageEdit dry-run", async () => {
    const p = createProvider("openai");
    const r = await p.imageEdit!({ prompt: "fix", projectRoot: dir });
    expect(r.dryRun).toBe(true);
    const buf = await readFile(r.outputPath);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("openai live path uses mocked fetch (no network)", async () => {
    delete process.env.AI2LIVE_MODEL_DRY_RUN;
    process.env.OPENAI_API_KEY = "sk-test";
    const input = path.join(dir, "in.png");
    await writeFile(input, TINY_PNG);
    const out = path.join(dir, "edited.png");

    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("/images/edits");
      return new Response(
        JSON.stringify({
          data: [{ b64_json: TINY_PNG.toString("base64") }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const p = createProvider("openai", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await p.imageEdit!({
      prompt: "edit",
      inputImagePath: input,
      outputPath: out,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.method).toBe("images_api");
    expect(await readFile(out)).toEqual(TINY_PNG);
    expect(fetchImpl).toHaveBeenCalled();
  });
});
