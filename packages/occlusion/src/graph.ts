/**
 * Occlusion graph helpers — richer fields (motion_risk, region_mask, completion_required).
 */
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import type { OcclusionEdge, LayerManifest } from "@ai2live/domain";

export interface OcclusionGraph {
  version: "0.2";
  character_id?: string;
  edges: OcclusionEdge[];
  note?: string;
  updated_at: string;
}

const SCENARIO_META: Record<
  string,
  { motion_risk: OcclusionEdge["motion_risk"]; completion_required: boolean; region_mask: string }
> = {
  bangs_under_face: {
    motion_risk: "high",
    completion_required: true,
    region_mask: "masks/completion_bangs_under_face.png",
  },
  face_over_back_hair: {
    motion_risk: "medium",
    completion_required: true,
    region_mask: "masks/completion_face_over_back_hair.png",
  },
  body_over_arm_root: {
    motion_risk: "medium",
    completion_required: true,
    region_mask: "masks/completion_body_over_arm_root.png",
  },
};

/** Enrich existing edges with richer fields when missing. */
export function enrichOcclusionEdges(edges: OcclusionEdge[]): OcclusionEdge[] {
  return edges.map((e) => {
    const notes = (e.notes ?? "").toLowerCase();
    let meta = SCENARIO_META.bangs_under_face!;
    if (notes.includes("back hair") || notes.includes("back_hair")) {
      meta = SCENARIO_META.face_over_back_hair!;
    } else if (notes.includes("arm")) {
      meta = SCENARIO_META.body_over_arm_root!;
    } else if (notes.includes("bang") || notes.includes("forehead")) {
      meta = SCENARIO_META.bangs_under_face!;
    }
    return {
      ...e,
      motion_risk: e.motion_risk ?? meta.motion_risk,
      completion_required: e.completion_required ?? meta.completion_required,
      region_mask: e.region_mask ?? meta.region_mask,
    };
  });
}

export async function writeOcclusionGraph(
  projectRoot: string,
  edges: OcclusionEdge[],
  opts?: { characterId?: string }
): Promise<string> {
  const root = path.resolve(projectRoot);
  const enriched = enrichOcclusionEdges(edges);
  const graph: OcclusionGraph = {
    version: "0.2",
    character_id: opts?.characterId,
    edges: enriched,
    note: "Richer occlusion graph: motion_risk, region_mask, completion_required",
    updated_at: new Date().toISOString(),
  };
  const dir = path.join(root, "spec");
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, "occlusion_graph.json");
  await writeFile(out, JSON.stringify(graph, null, 2) + "\n");

  // Patch layer_manifest occlusion_edges in place when present
  const manPath = path.join(dir, "layer_manifest.json");
  try {
    await access(manPath);
    const man = JSON.parse(await readFile(manPath, "utf8")) as LayerManifest;
    if (Array.isArray(man.occlusion_edges)) {
      const byId = new Map(enriched.map((e) => [e.id ?? `${e.occluder}->${e.occludee}`, e]));
      man.occlusion_edges = man.occlusion_edges.map((e) => {
        const key = e.id ?? `${e.occluder}->${e.occludee}`;
        return byId.get(key) ?? enrichOcclusionEdges([e])[0]!;
      });
      // Also merge any new enriched edges
      await writeFile(manPath, JSON.stringify(man, null, 2) + "\n");
    }
  } catch {
    /* optional */
  }
  return out;
}

export async function loadOcclusionGraph(projectRoot: string): Promise<OcclusionGraph | null> {
  try {
    const p = path.join(path.resolve(projectRoot), "spec", "occlusion_graph.json");
    return JSON.parse(await readFile(p, "utf8")) as OcclusionGraph;
  } catch {
    return null;
  }
}
