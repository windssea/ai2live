/**
 * @ai2live/workflow-registry — stub for M0.
 * Real implementation lands in later milestones.
 */
export const STUB = true as const;
export function notImplemented(feature: string): never {
  throw new Error(`@ai2live/workflow-registry: ${feature} not implemented yet (stub)`);
}
