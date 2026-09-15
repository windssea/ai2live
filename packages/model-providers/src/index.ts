export type {
  ProviderId,
  ModelMessage,
  ChatCompletionRequest,
  ChatCompletionResult,
  ImageEditRequest,
  ImageEditResult,
  ModelProvider,
  ProviderInfo,
} from "./types.js";

export {
  ProviderNotConfiguredError,
  ProviderBinaryMissingError,
} from "./errors.js";

export {
  createProvider,
  resolveProviderId,
  listProviders,
  providerConfigured,
  isDryRun,
} from "./factory.js";
export type { CreateProviderOptions } from "./factory.js";

export { shapeChatPayload, extractChatText, openAICompatChat, openAICompatChatStreamingAccumulated } from "./openai-compat/client.js";
export { dryRunChat } from "./openai-compat/dry-run.js";
export {
  dryRunImageEdit,
  openAICompatImageEdit,
  resolveImageOutputPath,
  TINY_PNG,
} from "./openai-compat/image-edit.js";

export {
  parseCodexExtraArgs,
  codexBin,
  codexCwd,
  codexTimeoutMs,
} from "./env.js";

export { createGrokProvider, isGrokConfigured } from "./providers/grok.js";
export { createOpenAIProvider, isOpenAIConfigured } from "./providers/openai.js";
export {
  createCodexProvider,
  probeCodexConfigured,
  buildCodexArgv,
} from "./providers/codex.js";
export type { CodexRunOptions, CodexInvocationStyle, BuildCodexArgvOptions } from "./providers/codex.js";
export {
  HttpRequestError,
  fetchWithRetry,
  assertOk,
  httpTimeoutMs,
  httpMaxRetries,
} from "./http.js";

export { runDoctor, formatDoctorReport } from "./doctor.js";
export type { DoctorCheck, DoctorReport } from "./doctor.js";
