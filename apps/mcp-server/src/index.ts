#!/usr/bin/env node
/**
 * Minimal JSON-RPC 2.0 MCP-compatible stdio server.
 *
 * Tools: compile, validate, providers, agent_plan
 * Speaks a subset of MCP (initialize, tools/list, tools/call) over
 * newline-delimited JSON-RPC on stdio — no heavy SDK required.
 */
import { createInterface } from "node:readline";
import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compilePsd } from "@ai2live/psd-compiler";
import { runStaticQc } from "@ai2live/qc-engine";
import { validateLayerManifest, validateCharacter } from "@ai2live/manifest-schema";
import { listProviders, resolveProviderId } from "@ai2live/model-providers";
import { createAgentContext, runPlannerChat } from "@ai2live/agent-runtime";

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

export const TOOLS: ToolDef[] = [
  {
    name: "compile",
    description: "Compile LayerManifest + PNGs → PSD for a project directory",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Absolute or relative project path" },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "validate",
    description: "Validate schemas + run static QC on a project",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string" },
      },
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
        projectDir: { type: "string" },
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

export async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case "compile": {
        const root = path.resolve(String(args.projectDir ?? ""));
        const result = await compilePsd({ projectRoot: root });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  psdPath: result.psdPath,
                  importManifestPath: result.importManifestPath,
                  recomposedPath: result.recomposedPath,
                },
                null,
                2
              ),
            },
          ],
        };
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  layer_manifest_valid: mr.valid,
                  character_valid: charValid,
                  qc_passed: report.passed,
                  findings: report.findings,
                  metrics: report.metrics,
                },
                null,
                2
              ),
            },
          ],
        };
      }
      case "providers": {
        const active = resolveProviderId();
        const rows = listProviders();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ active, providers: rows }, null, 2),
            },
          ],
        };
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
        return {
          content: [{ type: "text", text: JSON.stringify({ outPath, ...payload }, null, 2) }],
        };
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: (err as Error).message }],
      isError: true,
    };
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
