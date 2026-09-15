import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { buildPsd2LivePackage, type Psd2LiveBuildResult } from "./index.js";

/**
 * M5 deep integration protocol — still NO GPL code.
 * Emits a full MCP/CLI session script an external psd2live binary can execute.
 */
export async function writePsd2LiveDeepSession(opts: {
  projectRoot: string;
  buildId?: string;
  psdPath?: string;
  importManifestPath?: string;
}): Promise<{ sessionPath: string; packageResult: Psd2LiveBuildResult }> {
  const pkg = await buildPsd2LivePackage(opts);
  const session = {
    version: "0.1",
    backend: "psd2live",
    license: "external_process_only",
    working_directory: pkg.out_dir,
    mcp_session: [
      { tool: "project_create", args: { name: "ai2live_m5" } },
      { tool: "import_psd", args: { path: "character.psd" } },
      { tool: "apply_manifest", args: { path: "import_manifest.json" } },
      {
        tool: "build_rig",
        args: { mesh: "auto", deformers: "auto", physics: "templates" },
      },
      {
        tool: "render_pose_grid",
        args: {
          params: [
            "ParamAngleX",
            "ParamAngleY",
            "ParamAngleZ",
            "ParamMouthOpenY",
            "ParamEyeLOpen",
            "ParamEyeROpen",
          ],
          extremes: [-30, 0, 30],
        },
      },
      { tool: "export_model", args: { formats: ["cmo3", "moc3"] } },
      { tool: "write_report", args: { path: "psd2live_run_report.json" } },
    ],
    cli_equivalent: [
      "psd2live project create ai2live_m5",
      "psd2live import character.psd --manifest import_manifest.json",
      "psd2live build",
      "psd2live validate --pose-grid",
      "psd2live export --cmo3 --moc3",
    ],
    side_convention: "character-own LEFT/RIGHT",
  };
  const sessionPath = path.join(pkg.out_dir, "deep_session.json");
  await writeFile(sessionPath, JSON.stringify(session, null, 2));

  // Marker that deep integration is protocol-complete (execution requires external binary)
  await writeFile(
    path.join(pkg.out_dir, "DEEP_INTEGRATION.md"),
    `# psd2live deep integration\n\nThis package is ready for an **external** psd2live MCP/CLI.\nRun tools listed in deep_session.json.\n\n**Do not** copy psd2live GPL sources into ai2live.\n`
  );
  return { sessionPath, packageResult: pkg };
}

export async function checkExternalPsd2Live(): Promise<{
  available: boolean;
  hint: string;
}> {
  // We never shell out to unknown binaries with secrets; just document discovery.
  return {
    available: false,
    hint: "Install psd2live separately and point AI2LIVE_PSD2LIVE_BIN at it.",
  };
}
