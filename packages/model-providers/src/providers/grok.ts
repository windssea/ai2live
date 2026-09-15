import { ProviderNotConfiguredError } from "../errors.js";
import {
  grokApiKey,
  grokBaseUrl,
  grokDefaultModel,
  grokImageModel,
  isDryRun,
} from "../env.js";
import { openAICompatChat } from "../openai-compat/client.js";
import { dryRunChat } from "../openai-compat/dry-run.js";
import {
  dryRunImageEdit,
  openAICompatImageEdit,
} from "../openai-compat/image-edit.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ImageEditRequest,
  ImageEditResult,
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
    /**
     * Image edit via OpenAI-compatible Images API when the base URL supports it.
     * xAI may not expose /images/edits — dry-run always works; live calls may fail
     * with a clear error (chat+vision fallback is documented, not auto-wired yet).
     */
    async imageEdit(req: ImageEditRequest): Promise<ImageEditResult> {
      const key = grokApiKey();
      if (isDryRun() || !key) {
        if (!key && !isDryRun()) {
          throw new ProviderNotConfiguredError(
            id,
            [
              "Grok imageEdit requires AI2LIVE_GROK_API_KEY / XAI_API_KEY,",
              "or AI2LIVE_MODEL_DRY_RUN=1 (writes/copies PNG under previews/).",
              "Note: if xAI does not support /images/edits, use dry-run or OpenAI provider;",
              "chat+vision fallback is planned but not auto-invoked.",
            ].join(" ")
          );
        }
        return dryRunImageEdit(req);
      }

      return openAICompatImageEdit(
        {
          baseUrl: grokBaseUrl(),
          apiKey: key,
          defaultModel: grokImageModel(),
          provider: id,
          fetchImpl: opts?.fetchImpl ?? req.fetchImpl,
        },
        req
      );
    },
  };
}
