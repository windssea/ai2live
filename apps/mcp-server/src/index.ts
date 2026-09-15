#!/usr/bin/env node
/**
 * Minimal JSON-RPC 2.0 MCP-compatible stdio server.
 *
 * DESIGN §8-oriented tools (mapped to existing packages):
 *   inspect, compose, validate, downstream, revision
 * plus legacy: compile, providers, agent_plan
 */
import { createInterface } from "node:readline";
import path from "node:path";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compilePsd, recomposeNeutral } from "@ai2live/psd-compiler";
import { runStaticQc, runQualityGates } from "@ai2live/qc-engine";
import { validateLayerManifest, validateCharacter, assertLayerManifest } from "@ai2live/manifest-schema";
import { listProviders, resolveProviderId } from "@ai2live/model-providers";
import { createAgentContext, runPlannerChat } from "@ai2live/agent-runtime";
import { buildAutoLive2dPackage } from "@ai2live/autolive2d-adapter";
import { writePsd2LiveDeepSession } from "@ai2live/psd2live-adapter";
import {
  loadHistoryStore,
  checkoutRevision,
} from "@ai2live/history";
import type { LayerManifest } from "@ai2live/domain";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const projectDirProp = {
  projectDir: { type: "string", description: "Absolute or relative project path" },
};

export const TOOLS: ToolDef[] = [
  {
    name: "inspect",
    description:
      "DESIGN §8 inspect: summarize character/manifest/layers/history head for a project",
    inputSchema: {
      type: "object",
      properties: { ...projectDirProp },
      required: ["projectDir"],
    },
  },
  {
    name: "compose",
    description: "DESIGN §8 compose: recompose neutral preview from layer package",
    inputSchema: {
      type: "object",
      properties: { ...projectDirProp },
      required: ["projectDir"],
    },
  },
  {
    name: "validate",
    description: "DESIGN §8 validate: schemas + static QC + quality gates 0–5",
    inputSchema: {
      type: "object",
      properties: { ...projectDirProp },
      required: ["projectDir"],
    },
  },
  {
    name: "downstream",
    description: "DESIGN §8 downstream: write AutoLive2d package + psd2live deep session",
    inputSchema: {
      type: "object",
      properties: {
        ...projectDirProp,
        psdPath: { type: "string" },
        importManifestPath: { type: "string" },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "revision",
    description:
      "DESIGN §8 revision: action=list|checkout|head against validation/history.json",
    inputSchema: {
      type: "object",
      properties: {
        ...projectDirProp,
        action: { type: "string", description: "list | checkout | head" },
        rev: { type: "string", description: "Revision id for checkout" },
      },
      required: ["projectDir", "action"],
    },
  },
  {
    name: "compile",
    description: "Compile LayerManifest + PNGs → PSD for a project directory",
    inputSchema: {
      type: "object",
      properties: { ...projectDirProp },
      required: ["projectDir"],
    },
  },
  {
    name: "providers",
    description: "List model providers and configuration status",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "agent_plan",
    description: "Run LLM (or dry-run) planner; writes validation/llm_plan.json",
    inputSchema: {
      type: "object",
      properties: {
        ...projectDirProp,
        provider: { type: "string", description: "grok | openai | codex" },
        prompt: { type: "string" },
      },
      required: ["projectDir"],
    },
  },
];

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function ok(id: string | number | null | undefined, result: unknown): void {
  send({ jsonrpc: "2.0", id: id ?? null, result });
}

function fail(id: string | number | null | undefined, code: number, message: string): void {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function textResult(data: unknown, isError?: boolean) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case "inspect": {
        const root = path.resolve(String(args.projectDir ?? ""));
        const manPath = path.join(root, "spec", "layer_manifest.json");
        const charPath = path.join(root, "spec", "character.json");
        let manifest: unknown = null;
        let character: unknown = null;
        let manValid: boolean | null = null;
        if (await exists(manPath)) {
          manifest = JSON.parse(await readFile(manPath, "utf8"));
          manValid = validateLayerManifest(manifest).valid;
        }
        if (await exists(charPath)) {
          character = JSON.parse(await readFile(charPath, "utf8"));
        }
        const history = await loadHistoryStore(root);
        const layers = (manifest as { layers?: unknown[] } | null)?.layers ?? [];
        return textResult({
          projectDir: root,
          character,
          layer_manifest_valid: manValid,
          layer_count: Array.isArray(layers) ? layers.length : 0,
          history_head: history.getHead(),
          history_nodes: history.getNodes().length,
          has_master: await exists(path.join(root, "design", "master_neutral.png")),
        });
      }
      case "compose": {
        const root = path.resolve(String(args.projectDir ?? ""));
        const raw = JSON.parse(
          await readFile(path.join(root, "spec", "layer_manifest.json"), "utf8")
        );
        const manifest = assertLayerManifest(raw) as LayerManifest;
        const recomposed = await recomposeNeutral(root, manifest);
        const out = path.join(root, "previews", "recomposed_neutral.png");
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, recomposed.png);
        return textResult({
          recomposedPath: out,
          width: recomposed.width,
          height: recomposed.height,
        });
      }
      case "validate": {
        const root = path.resolve(String(args.projectDir ?? ""));
        const manPath = path.join(root, "spec", "layer_manifest.json");
        const man = JSON.parse(await readFile(manPath, "utf8"));
        const mr = validateLayerManifest(man);
        let charValid: boolean | null = null;
        try {
          const char = JSON.parse(
            await readFile(path.join(root, "spec", "character.json"), "utf8")
          );
          charValid = validateCharacter(char).valid;
        } catch {
          charValid = null;
        }
        const report = await runStaticQc({ projectRoot: root });
        let gates = null;
        try {
          gates = await runQualityGates({ projectRoot: root });
        } catch {
          gates = null;
        }
        return textResult({
          layer_manifest_valid: mr.valid,
          character_valid: charValid,
          qc_passed: report.passed,
          findings: report.findings,
          metrics: report.metrics,
          quality_gates: gates,
        });
      }
      case "downstream": {
        const root = path.resolve(String(args.projectDir ?? ""));
        const psdPath =
          (args.psdPath ? String(args.psdPath) : undefined) ??
          path.join(root, "psd", "character.psd");
        const importManifestPath =
          (args.importManifestPath ? String(args.importManifestPath) : undefined) ??
          path.join(root, "psd", "import_manifest.json");
        const al = await buildAutoLive2dPackage({
          projectRoot: root,
          psdPath,
          importManifestPath,
        });
        const deep = await writePsd2LiveDeepSession({
          projectRoot: root,
          psdPath,
          importManifestPath,
        });
        return textResult({
          autolive2d: al.out_dir,
          psd2live_deep: deep.sessionPath,
        });
      }
      case "revision": {
        const root = path.resolve(String(args.projectDir ?? ""));
        const action = String(args.action ?? "list");
        if (action === "list" || action === "head") {
          const history = await loadHistoryStore(root);
          return textResult({
            head: history.getHead(),
            nodes: history.getNodes().map((n) => ({
              id: n.id,
              parent_id: n.parent_id,
              action: n.action,
              message: n.message,
              created_at: n.created_at,
            })),
          });
        }
        if (action === "checkout") {
          const rev = String(args.rev ?? "");
          if (!rev) return textResult({ error: "rev required for checkout" }, true);
          const { node, restored, store } = await checkoutRevision(root, rev);
          return textResult({
            head: store.getHead(),
            checked_out: node.id,
            restored,
          });
        }
        return textResult({ error: `Unknown revision action: ${action}` }, true);
      }
      case "compile": {
        const root = path.resolve(String(args.projectDir ?? ""));
        const result = await compilePsd({ projectRoot: root });
        return textResult({
          psdPath: result.psdPath,
          importManifestPath: result.importManifestPath,
          recomposedPath: result.recomposedPath,
          roundtrip_passed: result.roundtrip?.passed ?? null,
        });
      }
      case "providers": {
        const active = resolveProviderId();
        const rows = listProviders();
        return textResult({ active, providers: rows });
      }
      case "agent_plan": {
        const root = path.resolve(String(args.projectDir ?? ""));
        const providerId = resolveProviderId(
          args.provider ? String(args.provider) : undefined
        );
        const ctx = createAgentContext(root, { providerId });
        const { plan, result, parsed } = await runPlannerChat(ctx, {
          userPrompt: args.prompt ? String(args.prompt) : undefined,
        });
        const outPath = path.join(root, "validation", "llm_plan.json");
        await mkdir(path.dirname(outPath), { recursive: true });
        const payload = {
          provider: result.provider,
          model: result.model,
          plan,
          parsed,
          raw_text: result.text,
        };
        await writeFile(outPath, JSON.stringify(payload, null, 2));
        return textResult({ outPath, ...payload });
      }
      default:
        return textResult({ error: `Unknown tool: ${name}` }, true);
    }
  } catch (err) {
    return textResult({ error: (err as Error).message }, true);
  }
}

export async function handle(msg: JsonRpcRequest): Promise<void> {
  const { id, method, params } = msg;
  if (!method) {
    fail(id, -32600, "Invalid Request");
    return;
  }

  switch (method) {
    case "initialize":
      ok(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "ai2live-mcp", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
    case "initialized":
      return;
    case "tools/list":
      ok(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = String(params?.name ?? "");
      const args = (params?.arguments as Record<string, unknown>) ?? {};
      const result = await callTool(name, args);
      ok(id, result);
      return;
    }
    case "ping":
      ok(id, {});
      return;
    default:
      fail(id, -32601, `Method not found: ${method}`);
  }
}

export function startMcpServer(): void {
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      fail(null, -32700, "Parse error");
      return;
    }
    void handle(msg).catch((err) => {
      fail(msg.id ?? null, -32603, (err as Error).message);
    });
  });
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(thisFile) === invoked) {
  startMcpServer();
}

