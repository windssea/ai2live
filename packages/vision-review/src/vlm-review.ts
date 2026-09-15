import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProvider, isDryRun, resolveProviderId, type ProviderId } from "@ai2live/model-providers";
import type { VlmVerdict } from "./types.js";

export interface VlmReviewOptions {
  projectRoot: string;
  /** Force dry-run mock (also honors AI2LIVE_MODEL_DRY_RUN). Default: true when not configured. */
  dryRun?: boolean;
  provider?: string;
  /** Optional context string (pose notes, gate summary). */
  context?: string;
  /** Write validation/vision_review.json when true (default true). */
  writeReport?: boolean;
}

/**
 * Optional VLM review via model provider.
 * Dry-run / unconfigured → structured MOCK_PASS (does not invent failures).
 */
export async function runVlmReview(opts: VlmReviewOptions): Promise<VlmVerdict> {
  const root = path.resolve(opts.projectRoot);
  // Default dry-run unless explicitly dryRun:false AND env is not forcing dry-run.
  const envDry = isDryRun() || process.env.AI2LIVE_MODEL_DRY_RUN === "1";
  const wantLive = opts.dryRun === false && !envDry;

  if (!wantLive) {
    const verdict: VlmVerdict = {
      source: "vlm",
      passed: true,
      status: "MOCK_PASS",
      dry_run: true,
      summary: "Dry-run VLM review: mock PASS (no live vision call)",
      issues: [],
      note:
        "Dry-run policy: MOCK_PASS counts as VLM pass for dual-judge merge; " +
        "set dryRun:false + provider credentials for live review.",
      raw: { mock: true, context: opts.context ?? null },
    };
    if (opts.writeReport !== false) {
      await writeVlmReport(root, verdict);
    }
    return verdict;
  }

  const providerId = resolveProviderId(opts.provider) as ProviderId;
  try {
    const provider = createProvider(providerId);
    const prompt = [
      "You are a Live2D asset vision reviewer.",
      "Given project QC context, reply JSON: {\"passed\":boolean,\"summary\":string,\"issues\":string[]}.",
      "Focus on hair naturalness, occlusion, face cracks, eye drift.",
      opts.context ? `Context:\n${opts.context}` : "No extra context.",
    ].join("\n");
    const chat = await provider.chat({
      messages: [
        { role: "system", content: "Return only JSON." },
        { role: "user", content: prompt },
      ],
      response_format: "json",
    });
    let parsed: { passed?: boolean; summary?: string; issues?: string[] } = {};
    try {
      parsed = JSON.parse(chat.text) as typeof parsed;
    } catch {
      parsed = { passed: false, summary: chat.text.slice(0, 200), issues: ["unparseable_vlm_json"] };
    }
    const passed = Boolean(parsed.passed);
    const verdict: VlmVerdict = {
      source: "vlm",
      passed,
      status: passed ? "PASS" : "FAIL",
      dry_run: false,
      summary: parsed.summary ?? (passed ? "VLM pass" : "VLM fail"),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      raw: chat.raw ?? chat.text,
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
      note: "Provider failure treated as VLM fail",
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
