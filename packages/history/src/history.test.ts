import { describe, it, expect } from "vitest";
import { HistoryStore, StaleHeadError } from "./index.js";

describe("HistoryStore", () => {
  it("append-only grows and updates head", () => {
    const h = new HistoryStore();
    const a = h.append({ expected_head: null, action: "create_project", seed: "a" });
    expect(h.getHead()).toBe(a.id);
    const b = h.append({ expected_head: a.id, action: "update_manifest", seed: "b" });
    expect(h.getHead()).toBe(b.id);
    expect(h.getNodes()).toHaveLength(2);
    expect(b.parent_id).toBe(a.id);
  });

  it("throws STALE_HEAD when expected_head mismatches", () => {
    const h = new HistoryStore();
    const a = h.append({ expected_head: null, action: "create_project", seed: "a" });
    expect(() =>
      h.append({ expected_head: null, action: "replace_layer_asset", seed: "bad" })
    ).toThrow(StaleHeadError);
    try {
      h.append({ expected_head: "rev_wrong", action: "x", seed: "c" });
    } catch (e) {
      expect(e).toBeInstanceOf(StaleHeadError);
      expect((e as StaleHeadError).code).toBe("STALE_HEAD");
      expect((e as StaleHeadError).expected).toBe("rev_wrong");
      expect((e as StaleHeadError).actual).toBe(a.id);
    }
  });
});
