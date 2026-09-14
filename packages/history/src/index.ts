import { createStableId } from "@ai2live/domain";

export type HistoryAction =
  | "create_project"
  | "replace_layer_asset"
  | "update_manifest"
  | "compile_psd"
  | "validate"
  | "candidate"
  | "commit_head"
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
      created_at: new Date().toISOString(),
      message: input.message,
    };
    this.nodes.push(node);
    this.head = node.id;
    return node;
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
