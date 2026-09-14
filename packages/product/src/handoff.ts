import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface HumanHandoff {
  reason: string;
  project_path: string;
  blocking_findings: string[];
  suggested_actions: string[];
}

export async function writeHandoff(root: string, handoff: HumanHandoff): Promise<string> {
  const dir = path.join(root, "validation");
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, "human_handoff.json");
  await writeFile(p, JSON.stringify({ ...handoff, timestamp: new Date().toISOString() }, null, 2));
  return p;
}
