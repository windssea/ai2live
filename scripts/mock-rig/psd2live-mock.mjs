#!/usr/bin/env node
/**
 * Mock psd2live CLI — used when AI2LIVE_USE_MOCK_RIG=1 and real CMD unset.
 * Does NOT vendor GPL psd2live; only writes mock session artifacts.
 */
import { writeFile, access } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`ai2live-mock-psd2live — mock psd2live runner (no GPL code)
Usage:
  psd2live-mock --help
  psd2live-mock --version
  psd2live-mock smoke <packageDir>
`);
  process.exit(0);
}
if (args.includes("--version") || args.includes("-V")) {
  console.log("ai2live-mock-psd2live 0.1.0");
  process.exit(0);
}

const cmd = args[0];
if (cmd === "smoke" || cmd === "import") {
  const pkg = path.resolve(args[1] || process.cwd());
  const out = path.join(pkg, "mock_psd2live_result.json");
  const payload = {
    version: "0.1",
    backend: "mock_psd2live",
    ok: true,
    package_dir: pkg,
    license_note: "Real psd2live is GPL — this mock never vendors it",
    note: "Mock smoke — set AI2LIVE_PSD2LIVE_CMD for real external invoke",
    timestamp: new Date().toISOString(),
  };
  await writeFile(out, JSON.stringify(payload, null, 2) + "\n");
  console.log(JSON.stringify(payload));
  process.exit(0);
}

console.error(`unknown command: ${cmd}`);
process.exit(2);
