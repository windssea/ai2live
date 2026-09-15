import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  canTransition,
  LEGAL_TRANSITIONS,
  PROJECT_STATES,
  advanceStateInMemory,
  createInitialState,
  IllegalTransitionError,
  loadProjectState,
  advanceProjectState,
  advanceFromPipelineStep,
  saveProjectState,
} from "./index.js";

describe("legal transitions", () => {
  it("covers all states in LEGAL_TRANSITIONS", () => {
    for (const s of PROJECT_STATES) {
      expect(LEGAL_TRANSITIONS[s]).toBeDefined();
      expect(Array.isArray(LEGAL_TRANSITIONS[s])).toBe(true);
    }
  });

  it("allows NEW → SPEC_READY and rejects NEW → PSD_READY", () => {
    expect(canTransition("NEW", "SPEC_READY")).toBe(true);
    expect(canTransition("NEW", "PSD_READY")).toBe(false);
  });

  it("allows STATIC_QC → REPAIRING → STATIC_QC", () => {
    expect(canTransition("STATIC_QC", "REPAIRING")).toBe(true);
    expect(canTransition("REPAIRING", "STATIC_QC")).toBe(true);
  });

  it("allows any happy state → NEEDS_REVIEW / FAILED / CANCELLED", () => {
    expect(canTransition("POSE_QC", "NEEDS_REVIEW")).toBe(true);
    expect(canTransition("ASSET_GENERATING", "FAILED")).toBe(true);
    expect(canTransition("PSD_READY", "CANCELLED")).toBe(true);
  });

  it("advanceStateInMemory throws on illegal edge", () => {
    const rec = createInitialState();
    expect(() => advanceStateInMemory(rec, "READY_FOR_EXPORT")).toThrow(IllegalTransitionError);
  });
});

describe("persistence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-sm-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("load defaults to NEW; advance persists .ai2live/state.json", async () => {
    const a = await loadProjectState(dir);
    expect(a.state).toBe("NEW");
    const b = await advanceProjectState(dir, "SPEC_READY", { reason: "test" });
    expect(b.state).toBe("SPEC_READY");
    const raw = JSON.parse(await readFile(path.join(dir, ".ai2live/state.json"), "utf8"));
    expect(raw.state).toBe("SPEC_READY");
    expect(raw.history).toHaveLength(1);
  });

  it("pipeline step walker: bootstrap → MASTER_READY via SPEC_READY", async () => {
    await saveProjectState(dir, createInitialState());
    const rec = await advanceFromPipelineStep(dir, "bootstrap", "ok");
    expect(rec?.state).toBe("MASTER_READY");
  });

  it("qc fail → REPAIRING", async () => {
    let rec = createInitialState();
    for (const s of [
      "SPEC_READY",
      "MASTER_READY",
      "LAYER_PLAN_READY",
      "ASSET_GENERATING",
      "STATIC_QC",
    ] as const) {
      rec = advanceStateInMemory(rec, s);
    }
    await saveProjectState(dir, rec);
    const next = await advanceFromPipelineStep(dir, "qc", "warn", { qcPassed: false });
    expect(next?.state).toBe("REPAIRING");
  });
});
