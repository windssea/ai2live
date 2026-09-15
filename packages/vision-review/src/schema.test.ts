import { describe, it, expect } from "vitest";
import { parseVlmReviewJson, VLM_REVIEW_SCHEMA_VERSION, resolveVlmLiveMode } from "./index.js";

describe("parseVlmReviewJson", () => {
  it("parses structured body", () => {
    const s = parseVlmReviewJson(
      JSON.stringify({
        passed: true,
        summary: "ok",
        issues: [],
        scores: { overall: 0.92, hair_naturalness: 0.9 },
      })
    );
    expect(s.passed).toBe(true);
    expect(s.scores.overall).toBeCloseTo(0.92);
    expect(s.scores.hair_naturalness).toBeCloseTo(0.9);
  });

  it("coerces string issues", () => {
    const s = parseVlmReviewJson(
      JSON.stringify({ passed: false, summary: "bad", issues: ["hair"], scores: { overall: 0.2 } })
    );
    expect(s.issues[0]?.code).toBe("other");
    expect(s.passed).toBe(false);
  });

  it("unparseable → fail", () => {
    const s = parseVlmReviewJson("not-json");
    expect(s.passed).toBe(false);
    expect(s.issues[0]?.message).toBe("unparseable_vlm_json");
  });
});

describe("resolveVlmLiveMode", () => {
  it("dryRun true → mock", () => {
    const m = resolveVlmLiveMode({ dryRun: true });
    expect(m.wantLive).toBe(false);
  });

  it("schema version stable", () => {
    expect(VLM_REVIEW_SCHEMA_VERSION).toBe("0.2");
  });
});
