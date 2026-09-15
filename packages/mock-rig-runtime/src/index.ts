export type {
  MockRigLayer,
  MockRigPose,
  MockRigRenderRequest,
  MockRigRenderResult,
} from "./types.js";
export {
  warpRgba,
  renderMockRigPose,
  discoverProjectLayers,
  renderPoseGridMockRig,
} from "./warp.js";

/** Default HeadX/Y (+ mouth/eye) extremes for pose QA. */
export const MOCK_RIG_DEFAULT_POSES: import("./types.js").MockRigPose[] = [
  {},
  { ParamAngleX: -30 },
  { ParamAngleX: 30 },
  { ParamAngleY: -30 },
  { ParamAngleY: 30 },
  { ParamAngleZ: -30 },
  { ParamAngleZ: 30 },
  { ParamMouthOpenY: 1 },
  { ParamEyeLOpen: 0, ParamEyeROpen: 0 },
];

/** Env gate: AI2LIVE_USE_MOCK_RIG (default on unless explicitly 0/false). */
export function useMockRigEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.AI2LIVE_USE_MOCK_RIG ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}
