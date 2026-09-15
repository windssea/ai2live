/** Layered PNG input for mock mesh-ish pose render. */
export interface MockRigLayer {
  id: string;
  /** Absolute or project-relative PNG path. */
  path: string;
  /** Semantic hint used for warp weights (HEAD/FACE/HAIR/BODY/ARM/EYE/MOUTH). */
  semantic?: string;
  z_index?: number;
  /** Optional pivot in normalized [0,1] canvas coords (default: head/face center heuristics). */
  pivot?: { x: number; y: number };
}

export interface MockRigPose {
  /** Cubism-like params. */
  ParamAngleX?: number;
  ParamAngleY?: number;
  ParamAngleZ?: number;
  ParamMouthOpenY?: number;
  ParamEyeLOpen?: number;
  ParamEyeROpen?: number;
  [k: string]: number | undefined;
}

export interface MockRigRenderRequest {
  projectRoot: string;
  layers: MockRigLayer[];
  pose: MockRigPose;
  width?: number;
  height?: number;
  outputPath: string;
  /** Label drawn on frame. */
  label?: string;
}

export interface MockRigRenderResult {
  outputPath: string;
  width: number;
  height: number;
  kind: "mock_mesh_warp";
  pose: MockRigPose;
  layers_used: number;
  note: string;
}
