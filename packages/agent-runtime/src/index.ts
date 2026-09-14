/**
 * @ai2live/agent-runtime — stub for M0.
 * Real implementation lands in later milestones.
 */
export const STUB = true as const;
export function notImplemented(feature: string): never {
  throw new Error(`@ai2live/agent-runtime: ${feature} not implemented yet (stub)`);
}
