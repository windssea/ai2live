export type ProviderId = "grok" | "openai" | "codex";

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  messages: ModelMessage[];
  model?: string;
  temperature?: number;
  response_format?: "text" | "json";
}

export interface ChatCompletionResult {
  provider: ProviderId;
  model: string;
  text: string;
  raw?: unknown;
}

export interface ImageEditRequest {
  prompt: string;
  inputImagePath?: string;
  maskPath?: string;
}

export interface ModelProvider {
  id: ProviderId;
  chat(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
  /** Optional; may throw ProviderNotConfiguredError */
  imageEdit?(req: ImageEditRequest): Promise<{ outputPath: string }>;
}

export interface ProviderInfo {
  id: ProviderId;
  configured: boolean;
  kind: string;
  defaultModel?: string;
}
