import { createHash, randomBytes } from "node:crypto";

/** Stable UUID v4 string. Prefer seeding for deterministic fixtures. */
export function createStableId(prefix = "", seed?: string): string {
  const hex = seed
    ? createHash("sha256").update(seed).digest("hex").slice(0, 32)
    : randomBytes(16).toString("hex");
  // Format as UUID-like: 8-4-4-4-12
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/** Short id for PSD layer names (4 hex chars from full id). */
export function shortId(id: string): string {
  const bare = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  const hex = bare.replace(/-/g, "");
  return hex.slice(0, 4);
}
