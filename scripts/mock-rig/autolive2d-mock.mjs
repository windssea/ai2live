#!/usr/bin/env node
/**
 * Mock AutoLive2d CLI — used when AI2LIVE_USE_MOCK_RIG=1 and real CMD unset.
 * Supports --help / --version / import <packageDir>
 */
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`ai2live-mock-autolive2d — mock AutoLive2d runner
Usage:
  autolive2d-mock --help
  autolive2d-mock --version
  autolive2d-mock import <packageDir>
`);
  process.exit(0);
}
if (args.includes("--version") || args.includes("-V")) {
  console.log("ai2live-mock-autolive2d 0.1.0");
  process.exit(0);
}

const cmd = args[0];
if (cmd === "import") {
  const pkg = path.resolve(args[1] || process.cwd());
  const out = path.join(pkg, "mock_import_result.json");
  let hasPsd = false;
  try {
    await access(path.join(pkg, "character.psd"));
    hasPsd = true;
  } catch { /* */ }
  const payload = {
    version: "0.1",
    backend: "mock_autolive2d",
    ok: true,
    package_dir: pkg,
    has_psd: hasPsd,
    note: "Mock import — set AI2LIVE_AUTOLIVE2D_CMD for real AutoLive2d",
    timestamp: new Date().toISOString(),
  };
  await writeFile(out, JSON.stringify(payload, null, 2) + "\n");
  console.log(JSON.stringify(payload));
  process.exit(0);
}

console.error(`unknown command: ${cmd}`);
process.exit(2);
