import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  HistoryStore,
  StaleHeadError,
  loadHistoryStore,
  saveHistoryStore,
  checkoutRevision,
  snapshotWorkspaceFiles,
} from "./index.js";

describe("HistoryStore", () => {
  it("append-only grows and updates head", () => {
    const h = new HistoryStore();
    const a = h.append({ expected_head: null, action: "create_project", seed: "a" });
    expect(h.getHead()).toBe(a.id);
    const b = h.append({ expected_head: a.id, action: "update_manifest", seed: "b" });
    expect(h.getHead()).toBe(b.id);
    expect(h.getNodes()).toHaveLength(2);
    expect(b.parent_id).toBe(a.id);
  });

  it("throws STALE_HEAD when expected_head mismatches", () => {
    const h = new HistoryStore();
    const a = h.append({ expected_head: null, action: "create_project", seed: "a" });
    expect(() =>
      h.append({ expected_head: null, action: "replace_layer_asset", seed: "bad" })
    ).toThrow(StaleHeadError);
    try {
      h.append({ expected_head: "rev_wrong", action: "x", seed: "c" });
    } catch (e) {
      expect(e).toBeInstanceOf(StaleHeadError);
      expect((e as StaleHeadError).code).toBe("STALE_HEAD");
      expect((e as StaleHeadError).expected).toBe("rev_wrong");
      expect((e as StaleHeadError).actual).toBe(a.id);
    }
  });

  it("checkout moves HEAD without deleting nodes", () => {
    const h = new HistoryStore();
    const a = h.append({ expected_head: null, action: "create_project", seed: "a" });
    const b = h.append({ expected_head: a.id, action: "compile_psd", seed: "b" });
    expect(h.getHead()).toBe(b.id);
    h.checkout(a.id);
    expect(h.getHead()).toBe(a.id);
    expect(h.getNodes()).toHaveLength(2);
    expect(h.ancestry(b.id).map((n) => n.id)).toEqual([a.id, b.id]);
  });
});

describe("history persistence + checkout", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ai2live-hist-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("save/load + checkout restores workspace snapshot", async () => {
    await mkdir(path.join(dir, "layers"), { recursive: true });
    await writeFile(path.join(dir, "layers/face.png"), Buffer.from("v1"));
    const store = new HistoryStore();
    const a = store.append({ expected_head: null, action: "create_project", seed: "a" });
    const snaps = await snapshotWorkspaceFiles(dir, a.id, ["layers/face.png"]);
    // mutate node with workspace_files via re-append pattern: patch JSON
    const data = store.toJSON();
    data.nodes[0]!.workspace_files = snaps;
    const store2 = HistoryStore.fromJSON(data);
    await saveHistoryStore(dir, store2);

    await writeFile(path.join(dir, "layers/face.png"), Buffer.from("v2"));
    const { restored } = await checkoutRevision(dir, a.id);
    expect(restored).toContain("layers/face.png");
    const body = await readFile(path.join(dir, "layers/face.png"), "utf8");
    expect(body).toBe("v1");

    const reloaded = await loadHistoryStore(dir);
    expect(reloaded.getHead()).toBe(a.id);
  });
});
