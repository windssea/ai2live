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
  /** Destination path for the edited image (required for dry-run / file writers). */
  outputPath?: string;
  /** Project root; when set and outputPath omitted, writes under previews/. */
  projectRoot?: string;
  /** Override image model (OpenAI Images API). */
  model?: string;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
}

export interface ImageEditResult {
  outputPath: string;
  dryRun?: boolean;
  method?: "images_api" | "dry_run_copy" | "dry_run_png" | "chat_vision_fallback";
  raw?: unknown;
}

export interface ModelProvider {
  id: ProviderId;
  chat(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
  /** Optional; may throw ProviderNotConfiguredError */
  imageEdit?(req: ImageEditRequest): Promise<ImageEditResult>;
}

export interface ProviderInfo {
  id: ProviderId;
  configured: boolean;
  kind: string;
  defaultModel?: string;
}
