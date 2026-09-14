import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { seeThroughFromMaster } from "./see-through.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples/simple-character");

describe("see-through fallback", () => {
  it("writes masks for example project", async () => {
    const r = await seeThroughFromMaster({ projectRoot: root });
    expect(r.masks.length).toBeGreaterThan(0);
    await access(path.join(root, r.masks[0].path));
  });
});
