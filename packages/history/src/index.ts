import { mkdir, readFile, writeFile, copyFile, access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createStableId } from "@ai2live/domain";

export type HistoryAction =
  | "create_project"
  | "replace_layer_asset"
  | "update_manifest"
  | "compile_psd"
  | "validate"
  | "candidate"
  | "commit_head"
  | "checkout"
  | "resume"
  | string;

export interface RevisionNode {
  id: string;
  parent_id: string | null;
  action: HistoryAction;
  target?: string;
  payload?: Record<string, unknown>;
  asset_hashes?: Record<string, string>;
  created_at: string;
  message?: string;
  /** Optional workspace snapshot paths keyed by relative path (copied on checkout). */
  workspace_files?: Record<string, string>;
}

export class StaleHeadError extends Error {
  readonly code = "STALE_HEAD" as const;
  constructor(
    public readonly expected: string | null,
    public readonly actual: string | null
  ) {
    super(`STALE_HEAD: expected ${expected}, actual ${actual}`);
    this.name = "StaleHeadError";
  }
}

export class HistoryStore {
  private nodes: RevisionNode[] = [];
  private head: string | null = null;

  getHead(): string | null {
    return this.head;
  }

  getNodes(): readonly RevisionNode[] {
    return this.nodes;
  }

  getNode(id: string): RevisionNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  /**
   * Append-only write. Caller must pass expected_head matching current HEAD
   * (or null when creating the first revision).
   */
  append(input: {
    expected_head: string | null;
    action: HistoryAction;
    target?: string;
    payload?: Record<string, unknown>;
    asset_hashes?: Record<string, string>;
    workspace_files?: Record<string, string>;
    message?: string;
    seed?: string;
  }): RevisionNode {
    if (input.expected_head !== this.head) {
      throw new StaleHeadError(input.expected_head, this.head);
    }
    const node: RevisionNode = {
      id: createStableId("rev", input.seed ?? `${Date.now()}-${this.nodes.length}`),
      parent_id: this.head,
      action: input.action,
      target: input.target,
      payload: input.payload,
      asset_hashes: input.asset_hashes,
      workspace_files: input.workspace_files,
      created_at: new Date().toISOString(),
      message: input.message,
    };
    this.nodes.push(node);
    this.head = node.id;
    return node;
  }

  /** Move HEAD pointer to an existing revision (does not delete newer nodes). */
  checkout(revId: string): RevisionNode {
    const node = this.getNode(revId);
    if (!node) throw new Error(`Unknown revision: ${revId}`);
    this.head = node.id;
    return node;
  }

  /** Alias for checkout — resume work from a prior revision. */
  resume(revId: string): RevisionNode {
    return this.checkout(revId);
  }

  /** Ancestors from root → rev (inclusive). */
  ancestry(revId: string): RevisionNode[] {
    const chain: RevisionNode[] = [];
    let cur: RevisionNode | undefined = this.getNode(revId);
    while (cur) {
      chain.push(cur);
      cur = cur.parent_id ? this.getNode(cur.parent_id) : undefined;
    }
    return chain.reverse();
  }

  /** Serialize for persistence */
  toJSON(): { head: string | null; nodes: RevisionNode[] } {
    return { head: this.head, nodes: [...this.nodes] };
  }

  static fromJSON(data: { head: string | null; nodes: RevisionNode[] }): HistoryStore {
    const s = new HistoryStore();
    s.nodes = [...data.nodes];
    s.head = data.head;
    return s;
  }
}

export const DEFAULT_HISTORY_PATH = path.posix.join("validation", "history.json");

/** Preferred snapshot root (DESIGN batch5). Legacy: validation/revisions/<rev>/ */
export const SNAPSHOT_ROOT = path.posix.join(".ai2live", "snapshots");
export const LEGACY_SNAPSHOT_ROOT = path.posix.join("validation", "revisions");

/** Key paths snapshotted for revision restore. */
export const IMPORTANT_SNAPSHOT_GLOBS = ["spec", "layers", "validation/report.json"] as const;

export async function loadHistoryStore(
  projectRoot: string,
  relativePath = DEFAULT_HISTORY_PATH
): Promise<HistoryStore> {
  const abs = path.join(projectRoot, relativePath);
  try {
    const raw = JSON.parse(await readFile(abs, "utf8")) as {
      head: string | null;
      nodes: RevisionNode[];
    };
    return HistoryStore.fromJSON(raw);
  } catch {
    return new HistoryStore();
  }
}

export async function saveHistoryStore(
  projectRoot: string,
  store: HistoryStore,
  relativePath = DEFAULT_HISTORY_PATH
): Promise<string> {
  const abs = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(store.toJSON(), null, 2));
  return abs;
}

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
