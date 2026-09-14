/**
 * @ai2live/image-client — stub for M0.
 * Real implementation lands in later milestones.
 */
export const STUB = true as const;
export function notImplemented(feature: string): never {
  throw new Error(`@ai2live/image-client: ${feature} not implemented yet (stub)`);
}
