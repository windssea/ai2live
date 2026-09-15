#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const api = spawn(process.execPath, [path.join(__dirname, "api.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

function shutdown(code) {
  api.kill("SIGTERM");
  vite.kill("SIGTERM");
  process.exit(code ?? 0);
}

api.on("exit", (c) => {
  if (c && c !== 0) shutdown(c);
});
vite.on("exit", (c) => shutdown(c ?? 0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
