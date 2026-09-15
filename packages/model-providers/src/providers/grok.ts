import { ProviderNotConfiguredError } from "../errors.js";
import {
  grokApiKey,
  grokBaseUrl,
  grokDefaultModel,
  isDryRun,
} from "../env.js";
import { openAICompatChat } from "../openai-compat/client.js";
import { dryRunChat } from "../openai-compat/dry-run.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ImageEditRequest,
  ModelProvider,
} from "../types.js";

export function isGrokConfigured(): boolean {
  return Boolean(grokApiKey()) || isDryRun();
}

export function createGrokProvider(opts?: {
  fetchImpl?: typeof fetch;
}): ModelProvider {
  const id = "grok" as const;
  const defaultModel = grokDefaultModel();

  return {
    id,
    async chat(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
      const key = grokApiKey();
      if (isDryRun() || !key) {
        if (!key && !isDryRun()) {
          throw new ProviderNotConfiguredError(
            id,
            [
              "Grok provider is not configured.",
              "Set AI2LIVE_GROK_API_KEY or XAI_API_KEY,",
              "or set AI2LIVE_MODEL_DRY_RUN=1 for a deterministic mock.",
              `Default model: ${defaultModel} (override with AI2LIVE_GROK_MODEL).`,
              `Base URL: ${grokBaseUrl()} (override with AI2LIVE_GROK_BASE_URL).`,
            ].join(" ")
          );
        }
        return dryRunChat(id, req.model ?? defaultModel, req);
      }

      const result = await openAICompatChat(
        {
          baseUrl: grokBaseUrl(),
          apiKey: key,
          defaultModel,
          fetchImpl: opts?.fetchImpl,
        },
        req
      );
      return {
        provider: id,
        model: result.model,
        text: result.text,
        raw: result.raw,
      };
    },
    async imageEdit(_req: ImageEditRequest): Promise<{ outputPath: string }> {
      throw new ProviderNotConfiguredError(
        id,
        "Grok imageEdit is not configured yet. Use a dedicated image pipeline or stub."
      );
    },
  };
}
