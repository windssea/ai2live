/**
 * Environment / connectivity diagnostics. Never prints secret values.
 */
import {
  resolveProviderId,
  isDryRun,
  grokApiKey,
  openaiApiKey,
  grokBaseUrl,
  openaiBaseUrl,
  grokDefaultModel,
  openaiDefaultModel,
  codexBin,
  httpTimeoutMs,
} from "./env.js";
import { listProviders, providerConfigured } from "./factory.js";
import type { ProviderId } from "./types.js";

export interface DoctorCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  next_steps: string[];
  active_provider: ProviderId;
  dry_run: boolean;
}

function keyPresent(name: string, value: string | undefined): DoctorCheck {
  return {
    id: `env.${name}`,
    ok: Boolean(value && value.trim()),
    detail: value && value.trim() ? "set (value hidden)" : "missing",
  };
}

async function probeWorker(url: string, timeoutMs: number): Promise<DoctorCheck> {
  const health = `${url.replace(/\/$/, "")}/health`;
  const fetchFn = globalThis.fetch;
  if (!fetchFn) {
    return { id: "worker.reachable", ok: false, detail: "fetch unavailable" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 5_000));
  try {
    const res = await fetchFn(health, { method: "GET", signal: controller.signal });
    return {
      id: "worker.reachable",
      ok: res.ok,
      detail: res.ok
        ? `reachable (${res.status}) at ${health}`
        : `HTTP ${res.status} at ${health}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: "worker.reachable",
      ok: false,
      detail: `unreachable: ${msg.split("\n")[0]}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run doctor checks. Does not print secrets.
 */
export async function runDoctor(): Promise<DoctorReport> {
  const active = resolveProviderId();
  const dry = isDryRun();
  const checks: DoctorCheck[] = [];

  checks.push(keyPresent("AI2LIVE_GROK_API_KEY|XAI_API_KEY", grokApiKey()));
  checks.push(keyPresent("AI2LIVE_OPENAI_API_KEY|OPENAI_API_KEY", openaiApiKey()));
  checks.push({
    id: "env.AI2LIVE_MODEL_PROVIDER",
    ok: true,
    detail: `active=${active}`,
  });
  checks.push({
    id: "env.AI2LIVE_MODEL_DRY_RUN",
    ok: true,
    detail: dry ? "enabled (deterministic mocks)" : "off",
  });
  checks.push({
    id: "env.AI2LIVE_HTTP_TIMEOUT_MS",
    ok: true,
    detail: `${httpTimeoutMs()}ms`,
  });

  const providers = listProviders();
  for (const p of providers) {
    checks.push({
      id: `provider.${p.id}.configured`,
      ok: p.configured,
      detail: p.configured
        ? `yes (${p.kind}, model=${p.defaultModel ?? "-"})`
        : `no — ${p.kind}`,
    });
  }

  checks.push({
    id: "provider.grok.base_url",
    ok: true,
    detail: grokBaseUrl(),
  });
  checks.push({
    id: "provider.openai.base_url",
    ok: true,
    detail: openaiBaseUrl(),
  });
  checks.push({
    id: "provider.codex.bin",
    ok: true,
    detail: codexBin(),
  });

  const workerUrl = process.env.AI2LIVE_IMAGE_WORKER_URL?.trim();
  if (workerUrl) {
    checks.push({
      id: "env.AI2LIVE_IMAGE_WORKER_URL",
      ok: true,
      detail: `set → ${workerUrl.replace(/\/$/, "")} (value is a URL, not a secret)`,
    });
    checks.push(await probeWorker(workerUrl, httpTimeoutMs()));
  } else {
    checks.push({
      id: "env.AI2LIVE_IMAGE_WORKER_URL",
      ok: false,
      detail: "unset (optional; TS client uses local stubs)",
    });
  }

  const next_steps: string[] = [];
  if (!providerConfigured(active) && !dry) {
    next_steps.push(
      `Active provider "${active}" is not configured. Set the matching API key, or export AI2LIVE_MODEL_DRY_RUN=1.`
    );
  }
  if (active === "grok" && !grokApiKey() && !dry) {
    next_steps.push("export AI2LIVE_GROK_API_KEY=…  (or XAI_API_KEY)");
  }
  if (active === "openai" && !openaiApiKey() && !dry) {
    next_steps.push("export OPENAI_API_KEY=…  (or AI2LIVE_OPENAI_API_KEY)");
  }
  if (active === "codex" && !providerConfigured("codex") && !dry) {
    next_steps.push("Install Codex CLI or set AI2LIVE_CODEX_BIN to an executable path.");
  }
  if (!workerUrl) {
    next_steps.push(
      "Optional: start services/image-worker-python and set AI2LIVE_IMAGE_WORKER_URL=http://127.0.0.1:8090"
    );
  } else {
    const w = checks.find((c) => c.id === "worker.reachable");
    if (w && !w.ok) {
      next_steps.push(
        `Worker URL is set but /health failed. Check the process and URL (${workerUrl}).`
      );
    }
  }
  next_steps.push("Copy .env.example → .env and fill keys (never commit .env).");
  next_steps.push("Docs: docs/providers.md · ai2live providers · ai2live agent plan <project>");
  if (dry) {
    next_steps.push("Dry-run is on — chat/imageEdit use mocks; unset AI2LIVE_MODEL_DRY_RUN for live calls.");
  }

  return {
    checks,
    next_steps,
    active_provider: active,
    dry_run: dry,
  };
}

/** Format report for CLI stdout (no secrets). */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`ai2live doctor — active provider: ${report.active_provider}  dry-run: ${report.dry_run}`);
  lines.push("");
  for (const c of report.checks) {
    const mark = c.ok ? "ok" : "!!";
    lines.push(`  [${mark}] ${c.id}: ${c.detail}`);
  }
  lines.push("");
  lines.push("Next steps:");
  for (const s of report.next_steps) {
    lines.push(`  - ${s}`);
  }
  lines.push("");
  lines.push(`Models: grok=${grokDefaultModel()} openai=${openaiDefaultModel()}`);
  return lines.join("\n");
}
