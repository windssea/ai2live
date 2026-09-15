import type { ChatCompletionRequest, ModelMessage } from "../types.js";

export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  /** Optional fetch for tests */
  fetchImpl?: typeof fetch;
}

export interface OpenAIChatPayload {
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  response_format?: { type: "json_object" } | { type: "text" };
}

/** Shape a ChatCompletionRequest into an OpenAI-compatible chat/completions body. */
export function shapeChatPayload(
  req: ChatCompletionRequest,
  defaultModel: string
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
  return payload;
}

export interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  model?: string;
  [key: string]: unknown;
}

export function extractChatText(data: OpenAIChatResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  return "";
}

export async function openAICompatChat(
  cfg: OpenAICompatConfig,
  req: ChatCompletionRequest
): Promise<{ model: string; text: string; raw: unknown }> {
  const payload = shapeChatPayload(req, cfg.defaultModel);
  const fetchFn = cfg.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error("fetch is not available in this runtime");
  }

  const url = `${cfg.baseUrl}/chat/completions`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenAI-compatible chat failed (${res.status} ${res.statusText}) at ${url}: ${body.slice(0, 500)}`
    );
  }

  const raw = (await res.json()) as OpenAIChatResponse;
  return {
    model: typeof raw.model === "string" ? raw.model : payload.model,
    text: extractChatText(raw),
    raw,
  };
}
