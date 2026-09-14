#!/usr/bin/env node
/** Smoke eval: compile + validate example. Exit 1 on QC fail. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "apps/cli/dist/cli.js");
const example = path.join(root, "examples/simple-character");
const r = spawnSync(process.execPath, [cli, "compile", example], { stdio: "inherit" });
process.exit(r.status ?? 1);
