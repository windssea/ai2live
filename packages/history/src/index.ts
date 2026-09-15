import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
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

/**
 * Checkout revision in-memory and restore any workspace_files snapshots
 * stored under validation/revisions/<revId>/...
 */
export async function checkoutRevision(
  projectRoot: string,
  revId: string,
  opts?: { historyPath?: string; restoreWorkspace?: boolean }
): Promise<{ store: HistoryStore; node: RevisionNode; restored: string[] }> {
  const store = await loadHistoryStore(projectRoot, opts?.historyPath);
  const node = store.checkout(revId);
  const restored: string[] = [];

  if (opts?.restoreWorkspace !== false && node.workspace_files) {
    for (const [rel, snapRel] of Object.entries(node.workspace_files)) {
      const src = path.join(projectRoot, snapRel);
      const dest = path.join(projectRoot, rel);
      try {
        await access(src);
        await mkdir(path.dirname(dest), { recursive: true });
        await copyFile(src, dest);
        restored.push(rel);
      } catch {
        /* skip missing snapshot */
      }
    }
  }

  // Record checkout as a new tip note? DESIGN wants HEAD move; we move head without append.
  await saveHistoryStore(projectRoot, store, opts?.historyPath);
  return { store, node, restored };
}

/** Snapshot selected files into validation/revisions/<revId>/ for later checkout. */
export async function snapshotWorkspaceFiles(
  projectRoot: string,
  revId: string,
  relativePaths: string[]
): Promise<Record<string, string>> {
  const mapping: Record<string, string> = {};
  for (const rel of relativePaths) {
    const src = path.join(projectRoot, rel);
    try {
      await access(src);
    } catch {
      continue;
    }
    const snapRel = path.posix.join("validation", "revisions", revId, rel);
    const dest = path.join(projectRoot, snapRel);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    mapping[rel] = snapRel;
  }
  return mapping;
}
