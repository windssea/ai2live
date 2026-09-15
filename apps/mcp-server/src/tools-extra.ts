/**
 * DESIGN §8 tools: design / view / asset / layer / task
 * Mapped onto bootstrap / pipeline / domain / history.
 */
import { mkdir, writeFile, readFile, access, readdir } from "node:fs/promises";
import path from "node:path";
import { createStableId, storeAsset } from "@ai2live/domain";
import { assertLayerManifest } from "@ai2live/manifest-schema";
import { recomposeNeutral } from "@ai2live/psd-compiler";
import { bootstrapProjectFromImage, ANIME_UPPER_BODY_TEMPLATE } from "@ai2live/pipeline";
import { loadHistoryStore, saveHistoryStore } from "@ai2live/history";
import { minRegionInpaint } from "@ai2live/image-client";
import type { LayerManifest } from "@ai2live/domain";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function textResult(data: unknown, isError?: boolean) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

export const EXTRA_TOOLS = [
  {
    name: "design",
    description:
      "DESIGN §8 design: action=create_spec|plan_layers|plan_differentials|plan_occlusion",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string" },
        action: { type: "string" },
        imagePath: { type: "string" },
        characterName: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["projectDir", "action"],
    },
  },
  {
    name: "view",
    description:
      "DESIGN §8 view: action=master|layer|composite|pose_grid|mask_overlay|context|compare",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string" },
        action: { type: "string" },
        layerId: { type: "string" },
        semantic: { type: "string" },
      },
      required: ["projectDir", "action"],
    },
  },
  {
    name: "asset",
    description:
      "DESIGN §8 asset: action=import|register|extract_pixels|apply_mask|inpaint|reprocess",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string" },
        action: { type: "string" },
        path: { type: "string" },
        maskPath: { type: "string" },
        outputPath: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["projectDir", "action"],
    },
  },
  {
    name: "layer",
    description:
      "DESIGN §8 layer: action=create|update_semantic|set_z|set_bounds|replace_asset|soft_delete|list",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string" },
        action: { type: "string" },
        layerId: { type: "string" },
        semantic: { type: "string" },
        z_index: { type: "number" },
        bounds: { type: "object" },
        asset_path: { type: "string" },
        display_name: { type: "string" },
        side: { type: "string" },
      },
      required: ["projectDir", "action"],
    },
  },
  {
    name: "task",
    description: "DESIGN §8 task: action=start|update|get|list (checkpointed long tasks)",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string" },
        action: { type: "string" },
        taskId: { type: "string" },
        name: { type: "string" },
        status: { type: "string" },
        checkpoint: { type: "object" },
      },
      required: ["projectDir", "action"],
    },
  },
] as const;

async function loadManifest(root: string): Promise<LayerManifest> {
  const raw = JSON.parse(await readFile(path.join(root, "spec", "layer_manifest.json"), "utf8"));
  return assertLayerManifest(raw) as LayerManifest;
}

async function saveManifest(root: string, manifest: LayerManifest): Promise<void> {
  await mkdir(path.join(root, "spec"), { recursive: true });
  await writeFile(
    path.join(root, "spec", "layer_manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
}

async function tasksPath(root: string): Promise<string> {
  const p = path.join(root, "validation", "tasks.json");
  await mkdir(path.dirname(p), { recursive: true });
  return p;
}

async function loadTasks(root: string): Promise<{
  tasks: Array<Record<string, unknown>>;
}> {
  const p = await tasksPath(root);
  if (!(await exists(p))) return { tasks: [] };
  return JSON.parse(await readFile(p, "utf8"));
}

async function saveTasks(root: string, data: { tasks: Array<Record<string, unknown>> }) {
  await writeFile(await tasksPath(root), JSON.stringify(data, null, 2));
}

export async function callExtraTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const root = path.resolve(String(args.projectDir ?? ""));
  const action = String(args.action ?? "");

  try {
    switch (name) {
      case "design": {
        if (action === "create_spec" || action === "plan_layers") {
          const imagePath = args.imagePath
            ? String(args.imagePath)
            : path.join(root, "design", "master_neutral.png");
          if (!(await exists(imagePath)) && action === "create_spec") {
            return textResult(
              {
                error: "imagePath required (or design/master_neutral.png)",
                template_semantics: ANIME_UPPER_BODY_TEMPLATE.map((t) => t.semantic),
              },
              true
            );
          }
          if (await exists(imagePath)) {
            const result = await bootstrapProjectFromImage({
              projectRoot: root,
              imagePath,
              characterName: args.characterName ? String(args.characterName) : undefined,
              dryRun: Boolean(args.dryRun ?? true),
            });
            return textResult({ action, ...result });
          }
          // plan_layers without image: return template plan summary
          return textResult({
            action,
            method: "template",
            layers: ANIME_UPPER_BODY_TEMPLATE.map((t) => ({
              key: t.key,
              semantic: t.semantic,
              side: t.side,
              z_index: t.z_index,
              bounds: t.bounds,
            })),
          });
        }
        if (action === "plan_differentials") {
          return textResult({
            action,
            differentials: ["mouth_open", "eye_close", "smile", "special_eye"],
            rule: "full_character_differential",
            hint: "Run ai2live expressions <project>",
          });
        }
        if (action === "plan_occlusion") {
          return textResult({
            action,
            scenarios: ["bangs_under_face", "face_over_back_hair", "body_over_arm_root"],
            hint: "Run ai2live occlusion <project>",
          });
        }
        return textResult({ error: `Unknown design action: ${action}` }, true);
      }
      case "view": {
        const spatial_reference_id = createStableId("view", `${action}-${Date.now()}`);
        if (action === "master") {
          const p = path.join(root, "design", "master_neutral.png");
          return textResult({
            spatial_reference_id,
            action,
            path: (await exists(p)) ? "design/master_neutral.png" : null,
            exists: await exists(p),
          });
        }
        if (action === "composite") {
          const manifest = await loadManifest(root);
          const recomposed = await recomposeNeutral(root, manifest);
          const out = path.join(root, "previews", "recomposed_neutral.png");
          await mkdir(path.dirname(out), { recursive: true });
          await writeFile(out, recomposed.png);
          return textResult({
            spatial_reference_id,
            action,
            path: "previews/recomposed_neutral.png",
            width: recomposed.width,
            height: recomposed.height,
          });
        }
        if (action === "layer") {
          const manifest = await loadManifest(root);
          const layer = args.layerId
            ? manifest.layers.find((l) => l.id === String(args.layerId))
            : args.semantic
              ? manifest.layers.find((l) =>
                  l.semantic.toUpperCase().includes(String(args.semantic).toUpperCase())
                )
              : undefined;
          return textResult({
            spatial_reference_id,
            action,
            layer: layer
              ? {
                  id: layer.id,
                  semantic: layer.semantic,
                  asset_path: layer.source.asset_path,
                  canvas_bounds: layer.canvas_bounds,
                  z_index: layer.z_index,
                }
              : null,
          });
        }
        if (action === "pose_grid") {
          const grid = path.join(root, "validation", "pose_grid");
          let files: string[] = [];
          if (await exists(grid)) {
            files = (await readdir(grid)).filter((f) => f.endsWith(".png"));
          }
          return textResult({
            spatial_reference_id,
            action,
            dir: "validation/pose_grid",
            files,
            count: files.length,
          });
        }
        if (action === "mask_overlay" || action === "context" || action === "compare") {
          return textResult({
            spatial_reference_id,
            action,
            note: `${action} returns path refs; full overlay compositing deferred`,
            masks_dir: (await exists(path.join(root, "masks"))) ? "masks/" : null,
            completions_dir: (await exists(path.join(root, "layers/completions")))
              ? "layers/completions/"
              : null,
          });
        }
        return textResult({ error: `Unknown view action: ${action}` }, true);
      }
      case "asset": {
        if (action === "import" || action === "register") {
          const src = String(args.path ?? "");
          if (!src || !(await exists(src))) {
            return textResult({ error: "path to existing file required" }, true);
          }
          const buf = await readFile(src);
          const stored = await storeAsset(root, buf, path.extname(src) || ".png");
          return textResult({
            action,
            hash: stored.hash,
            relativePath: stored.relativePath,
          });
        }
        if (action === "inpaint") {
          const imagePath = String(args.path ?? "");
          const maskPath = String(args.maskPath ?? "");
          if (!imagePath || !maskPath) {
            return textResult({ error: "path + maskPath required" }, true);
          }
          const out =
            args.outputPath
              ? String(args.outputPath)
              : path.join(root, "previews", `mcp_inpaint_${Date.now()}.png`);
          const r = await minRegionInpaint({
            imagePath,
            maskPath,
            outputPath: out,
            projectRoot: root,
            prompt: args.prompt ? String(args.prompt) : undefined,
            dryRun: true,
            forceLocal: true,
          });
          return textResult({ action, ...r });
        }
        if (action === "extract_pixels" || action === "apply_mask" || action === "reprocess") {
          return textResult({
            action,
            status: "acknowledged",
            note: `${action} mapped — use segmentation/occlusion CLI for full pipeline`,
          });
        }
        if (action === "remove_background") {
          return textResult({
            action,
            status: "not_implemented",
            note: "Background removal deferred to CV worker",
          });
        }
        return textResult({ error: `Unknown asset action: ${action}` }, true);
      }
      case "layer": {
        if (action === "list") {
          const manifest = await loadManifest(root);
          return textResult({
            action,
            layers: manifest.layers.map((l) => ({
              id: l.id,
              semantic: l.semantic,
              side: l.side,
              z_index: l.z_index,
              asset_path: l.source.asset_path,
              status: l.status,
            })),
          });
        }
        const manifest = await loadManifest(root);
        if (action === "create") {
          const id = createStableId("layer", `mcp-${Date.now()}`);
          const node = {
            id,
            display_name: String(args.display_name ?? args.semantic ?? "layer"),
            semantic: String(args.semantic ?? "UNKNOWN"),
            side: (args.side as "LEFT" | "RIGHT" | "CENTER") ?? "CENTER",
            z_index: Number(args.z_index ?? 50),
            canvas_bounds: (args.bounds as { x: number; y: number; w: number; h: number }) ?? {
              x: 0.2,
              y: 0.2,
              w: 0.6,
              h: 0.6,
            },
            source: {
              type: "generated_standalone" as const,
              asset_path: args.asset_path ? String(args.asset_path) : undefined,
            },
            status: "DRAFT" as const,
          };
          manifest.layers.push(node);
          await saveManifest(root, manifest);
          return textResult({ action, layer: node });
        }
        const layerId = String(args.layerId ?? "");
        const layer = manifest.layers.find((l) => l.id === layerId);
        if (!layer && action !== "list") {
          return textResult({ error: "layerId required / not found" }, true);
        }
        if (action === "update_semantic" && layer) {
          layer.semantic = String(args.semantic ?? layer.semantic);
          await saveManifest(root, manifest);
          return textResult({ action, layer });
        }
        if (action === "set_z" && layer) {
          layer.z_index = Number(args.z_index ?? layer.z_index);
          await saveManifest(root, manifest);
          return textResult({ action, layer });
        }
        if (action === "set_bounds" && layer) {
          layer.canvas_bounds = args.bounds as typeof layer.canvas_bounds;
          await saveManifest(root, manifest);
          return textResult({ action, layer });
        }
        if (action === "replace_asset" && layer) {
          const src = String(args.asset_path ?? args.path ?? "");
          if (!src) return textResult({ error: "asset_path required" }, true);
          layer.source.asset_path = src;
          await saveManifest(root, manifest);
          const history = await loadHistoryStore(root);
          try {
            history.append({
              expected_head: history.getHead(),
              action: "replace_layer_asset",
              target: layer.id,
              message: `MCP layer.replace_asset ${src}`,
            });
            await saveHistoryStore(root, history);
          } catch {
            /* history optional */
          }
          return textResult({ action, layer });
        }
        if (action === "soft_delete" && layer) {
          layer.status = "FAILED";
          await saveManifest(root, manifest);
          return textResult({ action, soft_deleted: true, layer });
        }
        if (action === "set_parent" && layer) {
          return textResult({
            action,
            layer,
            note: "parent field optional in current schema — recorded as no-op ack",
          });
        }
        return textResult({ error: `Unknown layer action: ${action}` }, true);
      }
      case "task": {
        const store = await loadTasks(root);
        if (action === "list") {
          return textResult({ action, tasks: store.tasks });
        }
        if (action === "start") {
          const id = createStableId("task", String(args.name ?? "task"));
          const task = {
            id,
            name: String(args.name ?? "unnamed"),
            status: "RUNNING",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            checkpoint: args.checkpoint ?? {},
          };
          store.tasks.push(task);
          await saveTasks(root, store);
          return textResult({ action, task });
        }
        if (action === "get") {
          const task = store.tasks.find((t) => t.id === String(args.taskId ?? ""));
          return textResult({ action, task: task ?? null }, !task);
        }
        if (action === "update") {
          const task = store.tasks.find((t) => t.id === String(args.taskId ?? ""));
          if (!task) return textResult({ error: "taskId not found" }, true);
          if (args.status) task.status = String(args.status);
          if (args.checkpoint) task.checkpoint = args.checkpoint;
          task.updated_at = new Date().toISOString();
          await saveTasks(root, store);
          return textResult({ action, task });
        }
        return textResult({ error: `Unknown task action: ${action}` }, true);
      }
      default:
        return textResult({ error: `Unknown tool: ${name}` }, true);
    }
  } catch (err) {
    return textResult({ error: (err as Error).message }, true);
  }
}
