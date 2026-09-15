/**
 * JSONL append + index history backend (DESIGN §20.3 alternative to SQLite).
 * Enabled when AI2LIVE_HISTORY_BACKEND=jsonl (or sqlite flag maps to jsonl stub).
 */
import { mkdir, readFile, writeFile, appendFile, access } from "node:fs/promises";
import path from "node:path";
import {
  HistoryStore,
  loadHistoryStore,
  saveHistoryStore,
  DEFAULT_HISTORY_PATH,
  type RevisionNode,
} from "./persist.js";

export const JSONL_DIR = path.posix.join(".ai2live", "history");
export const JSONL_EVENTS = path.posix.join(JSONL_DIR, "events.jsonl");
export const JSONL_INDEX = path.posix.join(JSONL_DIR, "index.json");

export type HistoryBackendKind = "json" | "jsonl" | "sqlite";

export function resolveHistoryBackend(
  env: NodeJS.ProcessEnv = process.env
): HistoryBackendKind {
  const v = (env.AI2LIVE_HISTORY_BACKEND ?? "json").trim().toLowerCase();
  if (v === "jsonl" || v === "sqlite") {
    return "jsonl";
  }
  return "json";
}

export interface HistoryIndex {
  version: "0.1";
  backend: "jsonl";
  head: string | null;
  ids: string[];
  by_id: Record<
    string,
    { action: string; parent_id: string | null; created_at: string; message?: string }
  >;
  note?: string;
}

async function ensureDir(projectRoot: string): Promise<string> {
  const dir = path.join(projectRoot, JSONL_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readHistoryIndex(projectRoot: string): Promise<HistoryIndex> {
  try {
    return JSON.parse(
      await readFile(path.join(projectRoot, JSONL_INDEX), "utf8")
    ) as HistoryIndex;
  } catch {
    return {
      version: "0.1",
      backend: "jsonl",
      head: null,
      ids: [],
      by_id: {},
      note: "empty",
    };
  }
}

function indexFromStore(store: HistoryStore): HistoryIndex {
  const nodes = store.getNodes();
  const by_id: HistoryIndex["by_id"] = {};
  for (const n of nodes) {
    by_id[n.id] = {
      action: String(n.action),
      parent_id: n.parent_id,
      created_at: n.created_at,
      message: n.message,
    };
  }
  return {
    version: "0.1",
    backend: "jsonl",
    head: store.getHead(),
    ids: nodes.map((n) => n.id),
    by_id,
    note: "JSONL append log + index (DESIGN §20.3). SQLite flag maps here (no native dep).",
  };
}

export async function appendHistoryJsonl(
  projectRoot: string,
  node: RevisionNode,
  store: HistoryStore
): Promise<{ eventsPath: string; indexPath: string }> {
  const root = path.resolve(projectRoot);
  await ensureDir(root);
  const eventsPath = path.join(root, JSONL_EVENTS);
  await appendFile(eventsPath, JSON.stringify(node) + "\n");
  const indexPath = path.join(root, JSONL_INDEX);
  await writeFile(indexPath, JSON.stringify(indexFromStore(store), null, 2) + "\n");
  await saveHistoryStore(root, store, DEFAULT_HISTORY_PATH);
  return { eventsPath, indexPath };
}

export async function loadHistoryStoreAuto(projectRoot: string): Promise<HistoryStore> {
  const root = path.resolve(projectRoot);
  const backend = resolveHistoryBackend();
  if (backend === "jsonl") {
    try {
      await access(path.join(root, JSONL_EVENTS));
      const raw = await readFile(path.join(root, JSONL_EVENTS), "utf8");
      const nodes: RevisionNode[] = [];
      for (const line of raw.split("\n")) {
        const s = line.trim();
        if (!s) continue;
        try {
          nodes.push(JSON.parse(s) as RevisionNode);
        } catch {
          /* skip */
        }
      }
      if (nodes.length) {
        const index = await readHistoryIndex(root);
        return HistoryStore.fromJSON({
          head: index.head ?? nodes[nodes.length - 1]!.id,
          nodes,
        });
      }
    } catch {
      /* fall through */
    }
  }
  return loadHistoryStore(root);
}

export async function saveHistoryStoreAuto(
  projectRoot: string,
  store: HistoryStore
): Promise<string> {
  const root = path.resolve(projectRoot);
  const backend = resolveHistoryBackend();
  const jsonPath = await saveHistoryStore(root, store, DEFAULT_HISTORY_PATH);
  if (backend === "jsonl") {
    await ensureDir(root);
    const eventsPath = path.join(root, JSONL_EVENTS);
    const nodes = store.getNodes();
    const body = nodes.map((n) => JSON.stringify(n)).join("\n") + (nodes.length ? "\n" : "");
    await writeFile(eventsPath, body);
    await writeFile(
      path.join(root, JSONL_INDEX),
      JSON.stringify(indexFromStore(store), null, 2) + "\n"
    );
  }
  return jsonPath;
}
