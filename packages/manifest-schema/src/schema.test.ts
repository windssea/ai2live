import { describe, it, expect } from "vitest";
import {
  validateCharacter,
  validateLayerManifest,
  validateValidationReport,
} from "./index.js";

describe("character schema", () => {
  it("accepts minimal valid character", () => {
    const r = validateCharacter({
      id: "char_01",
      name: "Demo",
      version: "0.1",
    });
    expect(r.valid).toBe(true);
  });

  it("rejects missing name", () => {
    const r = validateCharacter({ id: "x", version: "0.1" });
    expect(r.valid).toBe(false);
  });
});

describe("layer-manifest schema", () => {
  it("accepts a minimal layer manifest", () => {
    const r = validateLayerManifest({
      id: "man_01",
      version: "0.1",
      character_id: "char_01",
      canvas: { width: 256, height: 256 },
      layers: [
        {
          id: "layer_face",
          display_name: "face",
          semantic: "FACE",
          side: "CENTER",
          z_index: 100,
          source: { type: "user_asset", asset_path: "layers/face.png" },
        },
      ],
      spatial_references: [
        {
          id: "view_1",
          view_rect_canvas: [0, 0, 1, 1],
          source_pixel_rect: [0, 0, 256, 256],
          output_size: [256, 256],
        },
      ],
    });
    expect(r.valid).toBe(true);
  });

  it("rejects invalid side", () => {
    const r = validateLayerManifest({
      id: "man_01",
      version: "0.1",
      character_id: "char_01",
      canvas: { width: 256, height: 256 },
      layers: [
        {
          id: "layer_face",
          display_name: "face",
          semantic: "FACE",
          side: "VIEWER_LEFT",
          z_index: 100,
          source: { type: "user_asset" },
        },
      ],
    });
    expect(r.valid).toBe(false);
  });
});

describe("validation schema", () => {
  it("accepts report", () => {
    const r = validateValidationReport({
      id: "vr_1",
      version: "0.1",
      project_path: "/tmp/p",
      passed: true,
      metrics: { mse: 0 },
      findings: [],
    });
    expect(r.valid).toBe(true);
  });
});
