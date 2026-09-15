import { mkdir, writeFile, copyFile, access, readFile } from "node:fs/promises";
import path from "node:path";
import { createStableId } from "@ai2live/domain";

/**
 * psd2live downstream adapter.
 * Writes an import package for an EXTERNAL psd2live process/MCP.
 * Does NOT vendor or copy GPL psd2live source.
 */
export interface Psd2LiveBuildOptions {
  projectRoot: string;
  psdPath?: string;
  importManifestPath?: string;
  buildId?: string;
}

export interface Psd2LiveBuildResult {
  backend: "psd2live";
  build_id: string;
  out_dir: string;
  files: string[];
  warnings: string[];
  /** Instructions for invoking external psd2live — no GPL code inlined */
  invoke_hint: string;
}

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function buildPsd2LivePackage(
  opts: Psd2LiveBuildOptions
): Promise<Psd2LiveBuildResult> {
  const projectRoot = path.resolve(opts.projectRoot);
  const buildId = opts.buildId ?? createStableId("build", `p2l-${Date.now()}`);
  const outDir = path.join(projectRoot, "builds", "psd2live", buildId);
  await mkdir(outDir, { recursive: true });

  const psdPath = opts.psdPath ?? path.join(projectRoot, "psd", "character.psd");
  const importManifestPath =
    opts.importManifestPath ?? path.join(projectRoot, "psd", "import_manifest.json");

  const warnings: string[] = [];
  const files: string[] = [];

  if (!(await exists(psdPath))) {
    throw new Error(`PSD not found: ${psdPath}. Run compile first.`);
  }
  await copyFile(psdPath, path.join(outDir, "character.psd"));
  files.push("character.psd");

  if (await exists(importManifestPath)) {
    await copyFile(importManifestPath, path.join(outDir, "import_manifest.json"));
    files.push("import_manifest.json");
  } else {
    warnings.push("import_manifest.json missing");
  }

  const protocol = {
    version: "0.1",
    backend: "psd2live",
    license_note:
      "psd2live is GPL. ai2live talks to it as an external process only; no GPL source is vendored here.",
    side_convention: "LEFT/RIGHT = character-own left/right",
    steps: [
      { op: "project_open_or_create", args: { name: "ai2live_import" } },
      { op: "import_psd", args: { path: "character.psd" } },
      { op: "apply_import_manifest", args: { path: "import_manifest.json" } },
      { op: "build_model", args: {} },
      { op: "export", args: { formats: ["cmo3", "moc3"] } },
    ],
    mcp_tools_expected: [
      "inspect",
      "asset_import_png",
      "layer_add_from_asset",
      "view",
    ],
  };
  await writeFile(path.join(outDir, "psd2live_protocol.json"), JSON.stringify(protocol, null, 2));
  files.push("psd2live_protocol.json");

  const invoke_hint =
    "Run your installed psd2live CLI/MCP against this directory. Example: psd2live import --psd character.psd --manifest import_manifest.json";
  await writeFile(
    path.join(outDir, "README.md"),
    `# psd2live import package\n\n${invoke_hint}\n\nSee psd2live_protocol.json. GPL boundary: external process only.\n`
  );
  files.push("README.md");

  if (await exists(importManifestPath)) {
    const man = JSON.parse(await readFile(importManifestPath, "utf8"));
    await writeFile(
      path.join(outDir, "layer_index.json"),
      JSON.stringify({ build_id: buildId, layers: man.layers }, null, 2)
    );
    files.push("layer_index.json");
  }

  await writeFile(
    path.join(outDir, "build_result.json"),
    JSON.stringify({ backend: "psd2live", build_id: buildId, warnings, invoke_hint }, null, 2)
  );
  files.push("build_result.json");

  return {
    backend: "psd2live",
    build_id: buildId,
    out_dir: outDir,
    files,
    warnings,
    invoke_hint,
  };
}

export { writePsd2LiveDeepSession, checkExternalPsd2Live } from "./deep.js";

export { invokePsd2LiveSmoke, type Psd2LiveInvokeResult } from "./invoke.js";
