import type { ChatCompletionRequest, ChatCompletionResult, ProviderId } from "../types.js";

/**
 * Deterministic dry-run mock for OpenAI-compatible providers.
 * Used when AI2LIVE_MODEL_DRY_RUN=1 and no API key is present (or always when dry-run is set).
 */
export function dryRunChat(
  provider: ProviderId,
  model: string,
  req: ChatCompletionRequest
): ChatCompletionResult {
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
  const promptPreview = (lastUser?.content ?? "").slice(0, 200);

  let text: string;
  if (req.response_format === "json") {
    text = JSON.stringify(
      {
        dry_run: true,
        provider,
        model,
        summary: "Deterministic dry-run response (AI2LIVE_MODEL_DRY_RUN=1).",
        echo: promptPreview,
        plan_steps: [
          { phase: "inspect", tool: "validate_schemas" },
          { phase: "compile", tool: "compile_psd" },
          { phase: "validate", tool: "static_qc" },
        ],
        suggestions: [
          "Review validation/report.json",
          "Re-run compile after fixing layer PNGs",
        ],
      },
      null,
      2
    );
  } else {
    text = [
      `[dry-run:${provider}] model=${model}`,
      "Deterministic mock completion (AI2LIVE_MODEL_DRY_RUN=1). No network call was made.",
      promptPreview ? `Echo: ${promptPreview}` : "Echo: (empty prompt)",
    ].join("\n");
  }

  return {
    provider,
    model,
    text,
    raw: { dry_run: true, provider, model },
  };
}
