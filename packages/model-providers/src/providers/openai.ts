import { ProviderNotConfiguredError } from "../errors.js";
import {
  isDryRun,
  openaiApiKey,
  openaiBaseUrl,
  openaiDefaultModel,
  openaiImageModel,
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

export function isOpenAIConfigured(): boolean {
  return Boolean(openaiApiKey()) || isDryRun();
}

export function createOpenAIProvider(opts?: {
  fetchImpl?: typeof fetch;
}): ModelProvider {
  const id = "openai" as const;
  const defaultModel = openaiDefaultModel();

  return {
    id,
    async chat(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
      const key = openaiApiKey();
      if (isDryRun() || !key) {
        if (!key && !isDryRun()) {
          throw new ProviderNotConfiguredError(
            id,
            [
              "OpenAI provider is not configured.",
              "Set AI2LIVE_OPENAI_API_KEY or OPENAI_API_KEY,",
              "or set AI2LIVE_MODEL_DRY_RUN=1 for a deterministic mock.",
              `Default model: ${defaultModel} (override with AI2LIVE_OPENAI_MODEL).`,
              `Base URL: ${openaiBaseUrl()} (override with AI2LIVE_OPENAI_BASE_URL).`,
            ].join(" ")
          );
        }
        return dryRunChat(id, req.model ?? defaultModel, req);
      }

      const result = await openAICompatChat(
        {
          baseUrl: openaiBaseUrl(),
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
    async imageEdit(req: ImageEditRequest): Promise<ImageEditResult> {
      const key = openaiApiKey();
      if (isDryRun() || !key) {
        if (!key && !isDryRun()) {
          throw new ProviderNotConfiguredError(
            id,
            [
              "OpenAI imageEdit requires OPENAI_API_KEY / AI2LIVE_OPENAI_API_KEY,",
              "or AI2LIVE_MODEL_DRY_RUN=1 (writes/copies PNG under previews/).",
            ].join(" ")
          );
        }
        return dryRunImageEdit(req);
      }

      return openAICompatImageEdit(
        {
          baseUrl: openaiBaseUrl(),
          apiKey: key,
          defaultModel: openaiImageModel(),
          provider: id,
          fetchImpl: opts?.fetchImpl ?? req.fetchImpl,
        },
        req
      );
    },
  };
}
