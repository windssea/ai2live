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
  const systemBlob = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();
  const isDiagnose =
    systemBlob.includes("diagnosis") ||
    systemBlob.includes("repair") ||
    /validation summary/i.test(lastUser?.content ?? "");

  let text: string;
  if (req.response_format === "json") {
    if (isDiagnose) {
      text = JSON.stringify(
        {
          dry_run: true,
          provider,
          model,
          summary: "Deterministic dry-run diagnosis (AI2LIVE_MODEL_DRY_RUN=1).",
          echo: promptPreview,
          suggestions: [
            "Review validation/report.json",
            "Re-run compile after fixing layer PNGs",
            "Expand hidden completion for FRONT_HAIR on extreme ParamAngleX",
          ],
          recommended_repairs: [
            {
              type: "expand_hidden_completion",
              target: "FRONT_HAIR",
              rationale: "Head X extremes often expose unpainted forehead under bangs",
            },
            {
              type: "recompile",
              rationale: "Refresh PSD after layer fixes",
            },
          ],
          escalate_to_human: false,
        },
        null,
        2
      );
    } else {
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
    }
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
