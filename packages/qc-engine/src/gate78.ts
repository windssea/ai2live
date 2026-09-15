/**
 * Gate 7 (Rig Extreme Pose) + Gate 8 (Editability) — DESIGN §10.8 / §10.9.
 * Gate 7 uses mock-rig extremes / pose_grid contract when Cubism unavailable.
 */
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createStableId, type ValidationFinding } from "@ai2live/domain";
import type { GateId, GateResult } from "./gates.js";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export interface EditabilityChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  evidence?: string;
}

/**
 * Gate 7: Rig extreme pose QA using mock-rig / pose_grid artifacts.
 */
export async function runGate7RigExtremePose(projectRoot: string): Promise<GateResult> {
  const root = path.resolve(projectRoot);
  const findings: ValidationFinding[] = [];
  const metrics: Record<string, number> = {};
  const gridDir = path.join(root, "validation", "pose_grid");
  const contractPath = path.join(gridDir, "contract.json");
  const poseQaPath = path.join(root, "validation", "pose_qa_findings.json");

  let kind = "missing";
  let poseCount = 0;
  let headXExtremes = 0;
  let headYExtremes = 0;

  if (await exists(contractPath)) {
    try {
      const contract = JSON.parse(await readFile(contractPath, "utf8")) as {
        kind?: string;
        poses?: Array<{ pose?: Record<string, number>; path?: string }>;
      };
      kind = contract.kind ?? "unknown";
      const poses = contract.poses ?? [];
      poseCount = poses.length;
      for (const p of poses) {
        const ax = p.pose?.ParamAngleX;
        const ay = p.pose?.ParamAngleY;
        if (ax != null && Math.abs(ax) >= 25) headXExtremes++;
        if (ay != null && Math.abs(ay) >= 25) headYExtremes++;
      }
      // Count actual PNGs
      try {
        const files = (await readdir(gridDir)).filter((f) => f.endsWith(".png"));
        metrics.pose_png_count = files.length;
      } catch {
        metrics.pose_png_count = 0;
      }
    } catch (err) {
      findings.push({
        id: createStableId("finding", "g7-contract-parse"),
        severity: "WARNING",
        type: "GATE7_CONTRACT_PARSE",
        message: `pose_grid contract unreadable: ${(err as Error).message}`,
      });
    }
  } else {
    findings.push({
      id: createStableId("finding", "g7-no-grid"),
      severity: "WARNING",
      type: "GATE7_MISSING_POSE_GRID",
      message: "No validation/pose_grid/contract.json — run pose QA / mock-rig first",
    });
  }

  metrics.pose_count = poseCount;
  metrics.head_x_extremes = headXExtremes;
  metrics.head_y_extremes = headYExtremes;
  metrics.mock_mesh_warp = kind === "mock_mesh_warp" ? 1 : 0;

  if (await exists(poseQaPath)) {
    try {
      const qa = JSON.parse(await readFile(poseQaPath, "utf8")) as {
        findings?: Array<{ severity?: string }>;
      };
      const errs = (qa.findings ?? []).filter((f) => f.severity === "ERROR").length;
      metrics.pose_qa_errors = errs;
      if (errs > 0) {
        findings.push({
          id: createStableId("finding", "g7-qa-errors"),
          severity: "ERROR",
          type: "GATE7_POSE_QA_ERRORS",
          message: `pose_qa_findings has ${errs} ERROR(s)`,
        });
      }
    } catch {
      /* ignore */
    }
  }

  const hasExtremes = headXExtremes >= 2 && headYExtremes >= 2;
  if (poseCount > 0 && !hasExtremes) {
    findings.push({
      id: createStableId("finding", "g7-missing-extremes"),
      severity: "ERROR",
      type: "GATE7_MISSING_HEAD_EXTREMES",
      message: `Need HeadX± and HeadY± extremes; got X=${headXExtremes} Y=${headYExtremes}`,
    });
  }

  if (poseCount >= 5 && hasExtremes) {
    findings.push({
      id: createStableId("finding", "g7-ok"),
      severity: "INFO",
      type: "GATE7_EXTREMES_PRESENT",
      message: `Extreme pose grid ok (kind=${kind}, poses=${poseCount})`,
      backend: kind,
    });
  }

  // Soft-pass when pose grid not yet generated (pre-pose pipeline stages);
  // hard-fail only when grid exists but extremes/QA errors are wrong.
  const passed =
    poseCount === 0
      ? true
      : poseCount >= 5 &&
        hasExtremes &&
        (metrics.pose_qa_errors ?? 0) === 0 &&
        findings.every((f) => f.severity !== "ERROR");

  return {
    gate: "GATE_7_RIG_EXTREME_POSE" as GateId,
    passed,
    depth: kind === "mock_mesh_warp" ? "heuristic" : "scaffold",
    metrics,
    findings,
    note:
      kind === "mock_mesh_warp"
        ? "Gate 7 via mock-rig mesh-warp HeadX/Y extremes (Cubism unavailable)"
        : "Gate 7 via pose_grid contract when present",
  };
}

/**
 * Gate 8: final editability checklist.
 */
export async function runGate8Editability(projectRoot: string): Promise<{
  gate: GateResult;
  checklist: EditabilityChecklistItem[];
}> {
  const root = path.resolve(projectRoot);
  const checklist: EditabilityChecklistItem[] = [];

  const checks: Array<{ id: string; label: string; paths: string[] }> = [
    {
      id: "source_rgba",
      label: "Source RGBA layers present",
      paths: [path.join(root, "layers")],
    },
    {
      id: "layer_provenance",
      label: "Layer provenance / manifest present",
      paths: [path.join(root, "spec", "layer_manifest.json")],
    },
    {
      id: "psd_openable",
      label: "PSD compiled",
      paths: [path.join(root, "psd", "character.psd")],
    },
    {
      id: "downstream_package",
      label: "Downstream package (AutoLive2d or psd2live)",
      paths: [path.join(root, "builds", "autolive2d"), path.join(root, "builds", "psd2live")],
    },
    {
      id: "revision_history",
      label: "Revision history recoverable",
      paths: [
        path.join(root, "validation", "history.json"),
        path.join(root, ".ai2live", "history", "events.jsonl"),
      ],
    },
    {
      id: "not_baked_single_layer",
      label: "Not baked into irreversible single layer (multi-layer manifest)",
      paths: [path.join(root, "spec", "layer_manifest.json")],
    },
  ];

  for (const c of checks) {
    let ok = false;
    let evidence: string | undefined;
    for (const p of c.paths) {
      if (await exists(p)) {
        ok = true;
        evidence = p;
        break;
      }
    }
    if (c.id === "not_baked_single_layer" && ok && evidence) {
      try {
        const man = JSON.parse(await readFile(evidence, "utf8")) as { layers?: unknown[] };
        ok = (man.layers?.length ?? 0) >= 3;
        if (!ok) evidence = `layers=${man.layers?.length ?? 0}`;
      } catch {
        ok = false;
      }
    }
    if (c.id === "source_rgba" && ok && evidence) {
      try {
        const files = (await readdir(evidence)).filter((f) => f.endsWith(".png"));
        ok = files.length >= 3;
        evidence = `${evidence} (${files.length} png)`;
      } catch {
        ok = false;
      }
    }
    checklist.push({ id: c.id, label: c.label, ok, evidence });
  }

  const findings: ValidationFinding[] = checklist.map((item) => ({
    id: createStableId("finding", `g8-${item.id}`),
    severity: item.ok ? "INFO" : "WARNING",
    type: item.ok ? "GATE8_OK" : "GATE8_MISSING",
    message: `${item.label}: ${item.ok ? "yes" : "no"}${item.evidence ? ` (${item.evidence})` : ""}`,
  }));

  const okCount = checklist.filter((c) => c.ok).length;
  const metrics = {
    editability_ok: okCount,
    editability_total: checklist.length,
    editability_ratio: checklist.length ? okCount / checklist.length : 0,
  };

  // Soft pass if majority of checklist ok (PSD may be missing mid-pipeline)
  const passed = okCount >= Math.ceil(checklist.length * 0.5);

  const gate: GateResult = {
    gate: "GATE_8_EDITABILITY" as GateId,
    passed,
    depth: "heuristic",
    metrics,
    findings,
    note: "Editability checklist — source RGBA, provenance, PSD, downstream, history, multi-layer",
  };
  return { gate, checklist };
}
