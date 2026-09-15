import { describe, it, expect } from "vitest";
import {
  buildIdentityPrompt,
  buildStylePrompt,
  buildRigabilityPrompt,
  buildEditDeltaPrompt,
  buildNegativesPrompt,
  buildLayeredPrompt,
  occlusionEditDelta,
  expressionEditDelta,
} from "./builders.js";

describe("prompt-layers builders", () => {
  it("builds identity / style / rigability / negatives", () => {
    expect(buildIdentityPrompt({ name: "Ako" })).toContain("Ako");
    expect(buildStylePrompt({ medium: "watercolor anime" })).toContain("watercolor");
    expect(buildRigabilityPrompt({ overlapPx: 12 })).toContain("12px");
    expect(buildNegativesPrompt()).toMatch(/Negative Constraints/);
  });

  it("builds edit delta with lock + change", () => {
    const p = buildEditDeltaPrompt({ change: "fill forehead under bangs" });
    expect(p).toContain("Edit Delta");
    expect(p).toContain("fill forehead under bangs");
    expect(p).toContain("identity");
  });

  it("composes layered prompt for occlusion", () => {
    const layered = buildLayeredPrompt({
      identity: { name: "Test" },
      editDelta: occlusionEditDelta("bangs_under_face"),
    });
    expect(layered.combined).toContain("Identity:");
    expect(layered.combined).toContain("Art Style:");
    expect(layered.combined).toContain("Rigability:");
    expect(layered.combined).toContain("Edit Delta:");
    expect(layered.combined).toContain("Negative Constraints:");
    expect(layered.combined).toContain("forehead");
  });

  it("composes layered prompt for expression", () => {
    const layered = buildLayeredPrompt({
      editDelta: expressionEditDelta("smile"),
    });
    expect(layered.editDelta).toContain("smile");
    expect(layered.combined.split("\n").length).toBeGreaterThanOrEqual(5);
  });
});
