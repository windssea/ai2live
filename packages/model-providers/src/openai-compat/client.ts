import type { ChatCompletionRequest, ModelMessage } from "../types.js";
import {
  assertOk,
  fetchWithRetry,
  httpTimeoutMs,
  type FetchWithRetryOptions,
} from "../http.js";

export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  /** Optional fetch for tests */
  fetchImpl?: typeof fetch;
  /** Override AI2LIVE_HTTP_TIMEOUT_MS */
  timeoutMs?: number;
  /** Override AI2LIVE_HTTP_MAX_RETRIES (default 2) */
  maxRetries?: number;
}

export interface OpenAIChatPayload {
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  response_format?: { type: "json_object" } | { type: "text" };
  stream?: boolean;
}

/** Shape a ChatCompletionRequest into an OpenAI-compatible chat/completions body. */
export function shapeChatPayload(
  req: ChatCompletionRequest,
  defaultModel: string,
  opts?: { stream?: boolean }
): OpenAIChatPayload {
  const payload: OpenAIChatPayload = {
    model: req.model ?? defaultModel,
    messages: req.messages,
  };
  if (req.temperature !== undefined) {
    payload.temperature = req.temperature;
  }
  if (req.response_format === "json") {
    payload.response_format = { type: "json_object" };
  } else if (req.response_format === "text") {
    payload.response_format = { type: "text" };
  }
  if (opts?.stream || req.stream) {
    payload.stream = true;
  }
  return payload;
}

export interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null }; delta?: { content?: string | null } }>;
  model?: string;
  [key: string]: unknown;
}

export function extractChatText(data: OpenAIChatResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  return "";
}

function retryOpts(cfg: OpenAICompatConfig): FetchWithRetryOptions {
  return {
    fetchImpl: cfg.fetchImpl,
    timeoutMs: cfg.timeoutMs,
    maxRetries: cfg.maxRetries,
  };
}

/**
 * Non-streaming chat completion (default).
 * Retries with backoff on 408/429/5xx and network/timeouts.
 * Timeout: AI2LIVE_HTTP_TIMEOUT_MS (default 60000).
 */
export async function openAICompatChat(
  cfg: OpenAICompatConfig,
  req: ChatCompletionRequest
): Promise<{ model: string; text: string; raw: unknown }> {
  // Streaming is opt-in via req.stream; when set we accumulate SSE into one result.
  if (req.stream) {
    return openAICompatChatStreamingAccumulated(cfg, req);
  }

  const payload = shapeChatPayload(req, cfg.defaultModel);
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    retryOpts(cfg)
  );

  await assertOk(res, url);
  const raw = (await res.json()) as OpenAIChatResponse;
  return {
    model: typeof raw.model === "string" ? raw.model : payload.model,
    text: extractChatText(raw),
    raw,
  };
}

/**
 * Optional SSE streaming chat. Accumulates delta content into a single string.
 * Providers that do not support stream=true will fail with a clear HTTP error —
 * callers can omit stream (default) for maximum compatibility with xAI/OpenAI.
 *
 * Streaming is skipped/disabled unless ChatCompletionRequest.stream === true.
 */
export async function openAICompatChatStreamingAccumulated(
  cfg: OpenAICompatConfig,
  req: ChatCompletionRequest
): Promise<{ model: string; text: string; raw: unknown }> {
  const payload = shapeChatPayload(req, cfg.defaultModel, { stream: true });
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
    },
    retryOpts(cfg)
  );

  await assertOk(res, url);

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") && !contentType.includes("json")) {
    // Some gateways still return JSON even when stream=true
  }

  // If server ignored stream and returned JSON:
  if (contentType.includes("application/json")) {
    const raw = (await res.json()) as OpenAIChatResponse;
    return {
      model: typeof raw.model === "string" ? raw.model : payload.model,
      text: extractChatText(raw),
      raw,
    };
  }

  const body = res.body;
  if (!body) {
    const text = await res.text();
    return parseSseAccumulated(text, payload.model);
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let model = payload.model;
  const chunks: unknown[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as OpenAIChatResponse;
        chunks.push(json);
        if (typeof json.model === "string") model = json.model;
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string") accumulated += delta;
        const full = json.choices?.[0]?.message?.content;
        if (typeof full === "string" && !delta) accumulated += full;
      } catch {
        /* ignore malformed SSE lines */
      }
    }
  }

  return {
    model,
    text: accumulated,
    raw: { stream: true, chunks },
  };
}

function parseSseAccumulated(
  text: string,
  defaultModel: string
): { model: string; text: string; raw: unknown } {
  let accumulated = "";
  let model = defaultModel;
  const chunks: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as OpenAIChatResponse;
      chunks.push(json);
      if (typeof json.model === "string") model = json.model;
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === "string") accumulated += delta;
    } catch {
      /* ignore */
    }
  }
  return { model, text: accumulated, raw: { stream: true, chunks } };
}

export { httpTimeoutMs };
