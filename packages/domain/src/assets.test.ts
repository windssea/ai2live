import { describe, it, expect } from "vitest";
import { contentAddressedPath, sha256Hex, createStableId, shortId } from "./index.js";

describe("content-addressed assets", () => {
  it("builds sha256/ab/cd/... path", () => {
    const hash = "a".repeat(64);
    expect(contentAddressedPath(hash)).toBe(`assets/sha256/aa/aa/${hash}.png`);
  });

  it("rejects invalid hash", () => {
    expect(() => contentAddressedPath("nope")).toThrow();
  });

  it("sha256 is stable", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
    expect(sha256Hex("hello")).not.toBe(sha256Hex("world"));
  });
});

describe("stable ids", () => {
  it("deterministic from seed", () => {
    expect(createStableId("layer", "face")).toBe(createStableId("layer", "face"));
  });

  it("shortId is 4 hex", () => {
    const id = createStableId("layer", "x");
    expect(shortId(id)).toMatch(/^[0-9a-f]{4}$/);
  });
});
