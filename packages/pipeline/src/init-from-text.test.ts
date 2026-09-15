import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initProjectFromText, textToCharacterSpec } from "./init-from-text.js";
import { createStableId } from "@ai2live/domain";

describe("initFromText", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "init-text-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses hair/eye hints", () => {
    const s = textToCharacterSpec({
      text: "A pink long hair anime girl with blue eyes and bangs",
      characterId: createStableId("char", "t"),
      canvas: { width: 512, height: 768 },
    });
    expect(s.hair?.color).toBe("pink");
    expect(s.eyes?.color).toBe("blue");
    expect(s.style).toBe("anime_cel_clean");
  });

  it("writes character_spec + master + occlusion_graph", async () => {
    const r = await initProjectFromText({
      projectRoot: dir,
      text: "Silver hair twintail VTuber, red eyes, upper body",
      characterName: "Shiro",
      width: 256,
      height: 384,
    });
    await access(r.masterPath);
    await access(r.characterSpecPath);
    await access(path.join(dir, "spec", "occlusion_graph.json"));
    const graph = JSON.parse(await readFile(path.join(dir, "spec", "occlusion_graph.json"), "utf8"));
    expect(graph.edges[0].motion_risk).toBeTruthy();
    expect(graph.edges[0].completion_required).toBe(true);
    expect(r.method).toBe("synthetic_svg_master");
  });
});
