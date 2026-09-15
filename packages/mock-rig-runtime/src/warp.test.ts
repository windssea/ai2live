import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { warpRgba, renderMockRigPose, renderPoseGridMockRig, useMockRigEnabled } from "./index.js";

describe("mock-rig-runtime", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mock-rig-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("warpRgba moves pixels under ParamAngleX", async () => {
    const w = 32;
    const h = 32;
    const buf = Buffer.alloc(w * h * 4, 0);
    // opaque red block left-center
    for (let y = 10; y < 22; y++) {
      for (let x = 4; x < 12; x++) {
        const i = (y * w + x) * 4;
        buf[i] = 220;
        buf[i + 1] = 40;
        buf[i + 2] = 40;
        buf[i + 3] = 255;
      }
    }
    const warped = warpRgba(buf, w, h, { ParamAngleX: 30 }, "FACE");
    let moved = 0;
    for (let i = 0; i < w * h; i++) {
      if (warped[i * 4 + 3]! > 200 && warped[i * 4]! > 150) moved++;
    }
    expect(moved).toBeGreaterThan(10);
    // Should differ from identity for some pixels
    let diff = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] !== warped[i]) diff++;
    expect(diff).toBeGreaterThan(0);
  });

  it("renderPoseGridMockRig writes contract + shots", async () => {
    await mkdir(path.join(dir, "layers"), { recursive: true });
    await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 160, b: 140, alpha: 255 } },
    })
      .png()
      .toFile(path.join(dir, "layers", "FACE.png"));
    await writeFile(
      path.join(dir, "layer_manifest.json"),
      JSON.stringify({
        layers: [{ id: "face", semantic: "FACE", z_index: 1, png: "layers/FACE.png" }],
      })
    );
    const r = await renderPoseGridMockRig({
      projectRoot: dir,
      poses: [{}, { ParamAngleX: -30 }, { ParamAngleX: 30 }],
      width: 64,
      height: 64,
    });
    expect(r.kind).toBe("mock_mesh_warp");
    expect(r.shots.length).toBe(3);
    await access(path.join(r.gridDir, "contract.json"));
    await access(path.join(dir, "validation", "pose_grid", "pose_00.png"));
  });

  it("useMockRigEnabled defaults on", () => {
    expect(useMockRigEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(useMockRigEnabled({ AI2LIVE_USE_MOCK_RIG: "0" })).toBe(false);
  });
});
