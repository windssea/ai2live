import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  HistoryStore,
  appendHistoryJsonl,
  loadHistoryStoreAuto,
  saveHistoryStoreAuto,
  resolveHistoryBackend,
  JSONL_EVENTS,
  JSONL_INDEX,
} from "./index.js";

describe("jsonl history backend", () => {
  let dir: string;
  const saved = process.env.AI2LIVE_HISTORY_BACKEND;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hist-jsonl-"));
    process.env.AI2LIVE_HISTORY_BACKEND = "jsonl";
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env.AI2LIVE_HISTORY_BACKEND;
    else process.env.AI2LIVE_HISTORY_BACKEND = saved;
    await rm(dir, { recursive: true, force: true });
  });

  it("resolveHistoryBackend maps sqlite→jsonl", () => {
    expect(resolveHistoryBackend({ AI2LIVE_HISTORY_BACKEND: "sqlite" })).toBe("jsonl");
    expect(resolveHistoryBackend({ AI2LIVE_HISTORY_BACKEND: "jsonl" })).toBe("jsonl");
    expect(resolveHistoryBackend({ AI2LIVE_HISTORY_BACKEND: "json" })).toBe("json");
  });

  it("append + reload via JSONL", async () => {
    const store = new HistoryStore();
    const a = store.append({ expected_head: null, action: "create_project", seed: "a" });
    await appendHistoryJsonl(dir, a, store);
    const b = store.append({ expected_head: a.id, action: "compile_psd", seed: "b" });
    await appendHistoryJsonl(dir, b, store);
    await access(path.join(dir, JSONL_EVENTS));
    await access(path.join(dir, JSONL_INDEX));
    const lines = (await readFile(path.join(dir, JSONL_EVENTS), "utf8")).trim().split("\n");
    expect(lines.length).toBe(2);
    const loaded = await loadHistoryStoreAuto(dir);
    expect(loaded.getHead()).toBe(b.id);
    expect(loaded.getNodes()).toHaveLength(2);
    await saveHistoryStoreAuto(dir, loaded);
  });
});
