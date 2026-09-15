import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  localizeFailures,
  writeFailureLocalization,
  PROBLEM_TYPES,
} from "./failure-localization.js";
import type { VlmVerdict } from "./types.js";

describe("failure localization", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fail-loc-"));
    await mkdir(path.join(dir, "spec"), { recursive: true });
    await mkdir(path.join(dir, "validation"), { recursive: true });
    await writeFile(
      path.join(dir, "spec", "layer_manifest.json"),
      JSON.stringify({
        id: "m1",
        version: "0.1",
        character_id: "c1",
        canvas: { width: 64, height: 96 },
        layers: [
          { id: "layer_face", display_name: "face", semantic: "FACE", side: "CENTER" },
          { id: "layer_hair", display_name: "front_hair", semantic: "FRONT_HAIR", side: "CENTER" },
          { id: "layer_eye_l", display_name: "eye_l", semantic: "EYE", side: "LEFT" },
          { id: "layer_mouth", display_name: "mouth", semantic: "MOUTH", side: "CENTER" },
        ],
      }) + "\n"
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps VLM codes to problem_type + layer_id", () => {
    const vlm: VlmVerdict = {
      source: "vlm",
      passed: false,
      status: "FAIL",
      dry_run: true,
      summary: "fail",
      issues: [],
      structured: {
        passed: false,
        summary: "fail",
        issues: [
          { code: "eye_drift", severity: "ERROR", message: "eye moved" },
          { code: "hair_unnatural", severity: "WARNING", message: "bangs" },
          { code: "mouth_misalign", severity: "WARNING", message: "mouth" },
        ],
        scores: { overall: 0.3 },
      },
    };
    const findings = localizeFailures({
      layers: [
        { id: "layer_face", semantic: "FACE" },
        { id: "layer_hair", semantic: "FRONT_HAIR" },
        { id: "layer_eye_l", semantic: "EYE", side: "LEFT" },
        { id: "layer_mouth", semantic: "MOUTH" },
      ],
      vlm,
    });
    expect(findings.length).toBeGreaterThanOrEqual(3);
    const eye = findings.find((f) => f.problem_type === "EYE_ESCAPE");
    expect(eye?.layer_id).toBe("layer_eye_l");
    const hair = findings.find((f) => f.problem_type === "HAIR_ROOT_DETACH");
    expect(hair?.layer_id).toBe("layer_hair");
    const mouth = findings.find((f) => f.problem_type === "MOUTH_DRIFT");
    expect(mouth?.layer_id).toBe("layer_mouth");
    for (const f of findings) {
      expect(PROBLEM_TYPES).toContain(f.problem_type);
    }
  });

  it("attributes dry-run metric heuristics to layers", () => {
    const findings = localizeFailures({
      layers: [
        { id: "layer_face", semantic: "FACE" },
        { id: "layer_hair", semantic: "FRONT_HAIR" },
      ],
      metrics: { mae: 40, hair_naturalness: 0.2 },
    });
    expect(findings.some((f) => f.source === "metric" && f.problem_type === "STYLE_DRIFT")).toBe(
      true
    );
    expect(
      findings.some((f) => f.source === "metric" && f.problem_type === "HAIR_ROOT_DETACH")
    ).toBe(true);
  });

  it("writes validation/failure_localization.json", async () => {
    const report = await writeFailureLocalization({
      projectRoot: dir,
      cvFindings: [
        {
          id: "f1",
          severity: "ERROR",
          type: "COMPOSITE_MAE_HIGH",
          message: "mae too high",
        },
      ],
      metrics: { mae: 30 },
      passed: false,
    });
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0]!.layer_id).toBeTruthy();
    expect(PROBLEM_TYPES).toContain(report.findings[0]!.problem_type);
    const disk = JSON.parse(
      await readFile(path.join(dir, "validation", "failure_localization.json"), "utf8")
    );
    expect(disk.version).toBe("0.1");
    expect(disk.findings[0].problem_type).toBeTruthy();
  });
});
