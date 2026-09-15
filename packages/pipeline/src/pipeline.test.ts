import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, copyFile, mkdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFullPipeline, bootstrapProjectFromImage, PIPELINE_STEPS } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EXAMPLE = path.join(REPO_ROOT, "examples/simple-character");
const MASTER = path.join(EXAMPLE, "design/master_neutral.png");

const ENV_KEYS = [
  "AI2LIVE_MODEL_DRY_RUN",
  "AI2LIVE_MODEL_PROVIDER",
  "AI2LIVE_GROK_API_KEY",
  "XAI_API_KEY",
] as const;

describe("runFullPipeline dry-run", () => {
  const saved: Record<string, string | undefined> = {};
  let events: { type: string; step?: string }[] = [];

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
    events = [];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("runs on examples/simple-character and writes pipeline_report.json", async () => {
    const result = await runFullPipeline({
      projectRoot: EXAMPLE,
      provider: "grok",
      dryRun: true,
      skip: { bootstrap: true },
      onEvent: (e) => events.push({ type: e.type, step: e.step }),
    });

    expect(result.reportPath).toContain("pipeline_report.json");
    await access(result.reportPath);
    const report = JSON.parse(await readFile(result.reportPath, "utf8"));
    expect(report.steps?.length).toBeGreaterThan(5);
    expect(report.dry_run).toBe(true);
    expect(events.some((e) => e.type === "step_start")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
    const recorded = result.steps.map((s) => s.id);
    for (const id of ["doctor", "segment", "compile", "qc", "downstream", "report"] as const) {
      expect(recorded).toContain(id);
    }
  }, 120_000);

  it("bootstraps from a single image then runs pipeline in temp dir", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ai2live-from-image-"));
    try {
      await access(MASTER);
      const boot = await bootstrapProjectFromImage({
        projectRoot: dir,
        imagePath: MASTER,
        characterName: "Test From Image",
        dryRun: true,
        provider: "grok",
      });
      expect(boot.method).toBe("template");
      await access(boot.masterPath);
      await access(boot.manifestPath);

      const result = await runFullPipeline({
        projectRoot: dir,
        provider: "grok",
        dryRun: true,
        skip: { bootstrap: true },
        onEvent: (e) => events.push({ type: e.type, step: e.step }),
      });
      await access(result.reportPath);
      const report = JSON.parse(await readFile(result.reportPath, "utf8"));
      expect(Array.isArray(report.steps)).toBe(true);
      expect(result.artifacts.psd || report.artifacts?.psd).toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("fromImage option bootstraps inside runFullPipeline", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ai2live-run-from-"));
    try {
      const result = await runFullPipeline({
        projectRoot: dir,
        fromImage: MASTER,
        characterName: "One Shot",
        provider: "grok",
        dryRun: true,
      });
      await access(path.join(dir, "design", "master_neutral.png"));
      await access(path.join(dir, "spec", "layer_manifest.json"));
      await access(result.reportPath);
      expect(result.steps.some((s) => s.id === "bootstrap" && s.status !== "skip")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("PIPELINE_STEPS lists expected order", () => {
    expect(PIPELINE_STEPS[0]).toBe("bootstrap");
    expect(PIPELINE_STEPS).toContain("segment");
    expect(PIPELINE_STEPS).toContain("report");
  });
});
