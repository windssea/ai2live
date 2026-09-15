import { mkdir, copyFile, access, readdir, stat } from "node:fs/promises";
import path from "node:path";
export {
  HistoryStore,
  StaleHeadError,
  loadHistoryStore,
  saveHistoryStore,
  DEFAULT_HISTORY_PATH,
  SNAPSHOT_ROOT,
  LEGACY_SNAPSHOT_ROOT,
  IMPORTANT_SNAPSHOT_GLOBS,
  type HistoryAction,
  type RevisionNode,
} from "./persist.js";
import {
  HistoryStore,
  loadHistoryStore,
  saveHistoryStore,
  SNAPSHOT_ROOT,
  LEGACY_SNAPSHOT_ROOT,
  IMPORTANT_SNAPSHOT_GLOBS,
  type RevisionNode,
  type HistoryAction,
} from "./persist.js";

async function copyFileSafe(src: string, dest: string): Promise<boolean> {
  try {
    await access(src);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(dir: string, baseRel: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = path.posix.join(baseRel, e.name);
    if (e.isDirectory()) {
      out.push(...(await listFilesRecursive(abs, rel)));
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Snapshot selected files into `.ai2live/snapshots/<revId>/...` for later checkout.
 * Also accepts directories (copies files recursively).
 */
export async function snapshotWorkspaceFiles(
  projectRoot: string,
  revId: string,
  relativePaths: string[],
  opts?: { root?: "ai2live" | "legacy" }
): Promise<Record<string, string>> {
  const mapping: Record<string, string> = {};
  const snapBase =
    opts?.root === "legacy"
      ? path.posix.join(LEGACY_SNAPSHOT_ROOT, revId)
      : path.posix.join(SNAPSHOT_ROOT, revId);

  for (const relRaw of relativePaths) {
    const rel = relRaw.replace(/\\/g, "/").replace(/\/+$/, "");
    const src = path.join(projectRoot, rel);
    let st;
    try {
      st = await stat(src);
    } catch {
      continue;
    }
    if (st.isFile()) {
      const snapRel = path.posix.join(snapBase, rel);
      const dest = path.join(projectRoot, snapRel);
      if (await copyFileSafe(src, dest)) mapping[rel] = snapRel;
    } else if (st.isDirectory()) {
      const files = await listFilesRecursive(src, rel);
      for (const fileRel of files) {
        const snapRel = path.posix.join(snapBase, fileRel);
        const dest = path.join(projectRoot, snapRel);
        if (await copyFileSafe(path.join(projectRoot, fileRel), dest)) {
          mapping[fileRel] = snapRel;
        }
      }
    }
  }
  return mapping;
}

/** Snapshot spec/, layers/, validation/report.json under `.ai2live/snapshots/<rev>/`. */
export async function snapshotImportantWorkspace(
  projectRoot: string,
  revId: string
): Promise<Record<string, string>> {
  return snapshotWorkspaceFiles(projectRoot, revId, [...IMPORTANT_SNAPSHOT_GLOBS]);
}

/**
 * Append a revision and optionally snapshot important workspace files.
 */
export async function appendImportantRevision(
  projectRoot: string,
  input: {
    expected_head: string | null;
    action: HistoryAction;
    target?: string;
    payload?: Record<string, unknown>;
    asset_hashes?: Record<string, string>;
    message?: string;
    seed?: string;
    snapshot?: boolean;
  },
  opts?: { historyPath?: string }
): Promise<{ store: HistoryStore; node: RevisionNode }> {
  const store = await loadHistoryStore(projectRoot, opts?.historyPath);
  const node = store.append({
    expected_head: input.expected_head,
    action: input.action,
    target: input.target,
    payload: input.payload,
    asset_hashes: input.asset_hashes,
    message: input.message,
    seed: input.seed,
  });
  if (input.snapshot !== false) {
    const snaps = await snapshotImportantWorkspace(projectRoot, node.id);
    if (Object.keys(snaps).length) {
      node.workspace_files = snaps;
    }
  }
  await saveHistoryStore(projectRoot, store, opts?.historyPath);
  return { store, node };
}

/**
 * Checkout revision in-memory and restore any workspace_files snapshots
 * (`.ai2live/snapshots/<rev>/...` or legacy `validation/revisions/<rev>/...`).
 */
export async function checkoutRevision(
  projectRoot: string,
  revId: string,
  opts?: { historyPath?: string; restoreWorkspace?: boolean }
): Promise<{ store: HistoryStore; node: RevisionNode; restored: string[] }> {
  const store = await loadHistoryStore(projectRoot, opts?.historyPath);
  const node = store.checkout(revId);
  const restored: string[] = [];

  if (opts?.restoreWorkspace !== false) {
    const mapping = { ...(node.workspace_files ?? {}) };

    // If node lacks mapping, try discovering under preferred + legacy roots
    if (Object.keys(mapping).length === 0) {
      for (const rootRel of [
        path.posix.join(SNAPSHOT_ROOT, revId),
        path.posix.join(LEGACY_SNAPSHOT_ROOT, revId),
      ]) {
        const absRoot = path.join(projectRoot, rootRel);
        const files = await listFilesRecursive(absRoot, "");
        for (const f of files) {
          mapping[f] = path.posix.join(rootRel, f);
        }
        if (files.length) break;
      }
    }

    for (const [rel, snapRel] of Object.entries(mapping)) {
      const src = path.join(projectRoot, snapRel);
      const dest = path.join(projectRoot, rel);
      if (await copyFileSafe(src, dest)) restored.push(rel);
    }
  }

  await saveHistoryStore(projectRoot, store, opts?.historyPath);
  return { store, node, restored };
}

export {
  resolveHistoryBackend,
  appendHistoryJsonl,
  loadHistoryStoreAuto,
  saveHistoryStoreAuto,
  readHistoryIndex,
  JSONL_DIR,
  JSONL_EVENTS,
  JSONL_INDEX,
  type HistoryBackendKind,
  type HistoryIndex,
} from "./jsonl-backend.js";

