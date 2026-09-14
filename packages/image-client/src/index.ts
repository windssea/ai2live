/**
 * Image client — talks to local/python worker or in-process stubs.
 * M1: segmentation + see-through fallback (deterministic CV stubs).
 */
export interface SegmentRequest {
  masterPath: string;
  labels?: string[];
}

export interface SegmentMask {
  label: string;
  /** Relative path written under masks/ */
  path: string;
  method: "stub_bbox" | "see_through" | "model";
}

export interface SegmentResult {
  masks: SegmentMask[];
  warnings: string[];
}

export const STUB = false as const;

export function notImplemented(feature: string): never {
  throw new Error(`@ai2live/image-client: ${feature} not implemented`);
}
