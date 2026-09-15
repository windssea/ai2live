import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createProvider,
  isDryRun,
  resolveProviderId,
  providerConfigured,
  type ProviderId,
} from "@ai2live/model-providers";
import type { VlmVerdict } from "./types.js";
import {
  VLM_REVIEW_JSON_SCHEMA,
  VLM_REVIEW_SCHEMA_VERSION,
  parseVlmReviewJson,
  vlmSystemPrompt,
} from "./schema.js";

export interface VlmReviewOptions {
  projectRoot: string;
  /**
   * Force dry-run mock. Default: dry-run unless API keys present and dryRun:false,
   * OR when AI2LIVE_VLM_LIVE=1 / keys present and dryRun not forced true.
   */
  dryRun?: boolean;
  provider?: string;
  /** Optional context string (pose notes, gate summary). */
  context?: string;
  /** Write validation/vision_review.json when true (default true). */
  writeReport?: boolean;
  /** Prefer live when keys present even if dryRun omitted (default true). */
  preferLiveWhenConfigured?: boolean;
}

function envForcesDryRun(): boolean {
  return isDryRun() || process.env.AI2LIVE_MODEL_DRY_RUN === "1";
}

function envForcesLive(): boolean {
  return process.env.AI2LIVE_VLM_LIVE === "1" || process.env.AI2LIVE_VISION_LIVE === "1";
}

function hasApiKeys(providerId: ProviderId): boolean {
  try {
    return providerConfigured(providerId);
  } catch {
    return false;
  }
}

/**
 * Decide live vs mock:
 * - Explicit dryRun:true → mock
 * - AI2LIVE_MODEL_DRY_RUN=1 → mock (unless AI2LIVE_VLM_LIVE=1 overrides for intentional live tests)
 * - dryRun:false → live (needs keys)
 * - dryRun omitted + keys + preferLive → live
 * - else mock
 */
export function resolveVlmLiveMode(opts: {
  dryRun?: boolean;
  provider?: string;
  preferLiveWhenConfigured?: boolean;
}): { wantLive: boolean; reason: string; providerId: ProviderId } {
  const providerId = resolveProviderId(opts.provider) as ProviderId;
  const prefer = opts.preferLiveWhenConfigured !== false;
  const keys = hasApiKeys(providerId);
  const forceLive = envForcesLive();
  const forceDry = envForcesDryRun() && !forceLive;

  if (opts.dryRun === true || forceDry) {
    return { wantLive: false, reason: forceDry ? "env_dry_run" : "dryRun_true", providerId };
  }
  if (opts.dryRun === false) {
    return {
      wantLive: keys || forceLive,
      reason: keys || forceLive ? "dryRun_false" : "dryRun_false_but_unconfigured",
      providerId,
    };
  }
  // dryRun omitted
  if ((prefer && keys) || forceLive) {
    return { wantLive: true, reason: forceLive ? "AI2LIVE_VLM_LIVE" : "api_keys_present", providerId };
  }
  return { wantLive: false, reason: "no_keys_default_mock", providerId };
}

function mockPassVerdict(context?: string): VlmVerdict {
  return {
    source: "vlm",
    passed: true,
    status: "MOCK_PASS",
    dry_run: true,
    summary: "Dry-run VLM review: mock PASS (no live vision call)",
    issues: [],
    schema_version: VLM_REVIEW_SCHEMA_VERSION,
    structured: {
      passed: true,
      summary: "Dry-run VLM review: mock PASS (no live vision call)",
      issues: [],
      scores: { overall: 0.9 },
      recommendations: [],
    },
    note:
      "Dry-run policy: MOCK_PASS counts as VLM pass for dual-judge merge; " +
      "set dryRun:false + provider credentials (or AI2LIVE_VLM_LIVE=1) for live review.",
    raw: { mock: true, context: context ?? null, schema: VLM_REVIEW_JSON_SCHEMA.$id },
  };
}

/**
 * Optional VLM review via model provider.
 * Live when API keys present (and not forced dry-run); otherwise structured MOCK_PASS.
 */
export async function runVlmReview(opts: VlmReviewOptions): Promise<VlmVerdict> {
  const root = path.resolve(opts.projectRoot);
  const mode = resolveVlmLiveMode({
    dryRun: opts.dryRun,
    provider: opts.provider,
    preferLiveWhenConfigured: opts.preferLiveWhenConfigured,
  });

  if (!mode.wantLive) {
    const verdict = mockPassVerdict(opts.context);
    verdict.note = `${verdict.note} mode_reason=${mode.reason}`;
    if (opts.writeReport !== false) {
      await writeVlmReport(root, verdict);
    }
    return verdict;
  }

  // Live path requested but provider not configured → soft fail with clear note
  if (!hasApiKeys(mode.providerId) && !envForcesLive()) {
    const verdict: VlmVerdict = {
      source: "vlm",
      passed: false,
      status: "FAIL",
      dry_run: false,
      summary: `Live VLM requested but provider ${mode.providerId} not configured`,
      issues: ["vlm_provider_unconfigured"],
      schema_version: VLM_REVIEW_SCHEMA_VERSION,
      note: `mode_reason=${mode.reason}`,
    };
    if (opts.writeReport !== false) await writeVlmReport(root, verdict);
    return verdict;
  }

  try {
    const provider = createProvider(mode.providerId);
    const userPrompt = [
      "Review this Live2D layer package QC context.",
      "Reply with JSON only matching the schema (passed, summary, issues, scores, recommendations).",
      opts.context ? `Context:\n${opts.context}` : "No extra context.",
      `JSON Schema id: ${VLM_REVIEW_JSON_SCHEMA.$id}`,
      `Required scores.overall; issues use severity ERROR|WARNING|INFO.`,
    ].join("\n");
    const chat = await provider.chat({
      messages: [
        { role: "system", content: vlmSystemPrompt() },
        { role: "user", content: userPrompt },
      ],
      response_format: "json",
    });
    const structured = parseVlmReviewJson(chat.text);
    const issueStrings = structured.issues.map(
      (i) => `${i.severity}:${i.code}:${i.message}`
    );
    const verdict: VlmVerdict = {
      source: "vlm",
      passed: structured.passed,
      status: structured.passed ? "PASS" : "FAIL",
      dry_run: false,
      summary: structured.summary,
      issues: issueStrings,
      schema_version: VLM_REVIEW_SCHEMA_VERSION,
      structured,
      scores: structured.scores as VlmVerdict["scores"],
      raw: chat.raw ?? chat.text,
      note: `Live VLM via ${mode.providerId}; mode_reason=${mode.reason}`,
    };
    if (opts.writeReport !== false) await writeVlmReport(root, verdict);
    return verdict;
  } catch (err) {
    const verdict: VlmVerdict = {
      source: "vlm",
      passed: false,
      status: "FAIL",
      dry_run: false,
      summary: `VLM review error: ${(err as Error).message}`,
      issues: ["vlm_provider_error"],
      schema_version: VLM_REVIEW_SCHEMA_VERSION,
      note: `Provider failure treated as VLM fail; mode_reason=${mode.reason}`,
    };
    if (opts.writeReport !== false) await writeVlmReport(root, verdict);
    return verdict;
  }
}

async function writeVlmReport(root: string, verdict: VlmVerdict): Promise<void> {
  const dir = path.join(root, "validation");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "vision_review.json"), JSON.stringify(verdict, null, 2) + "\n");
}
