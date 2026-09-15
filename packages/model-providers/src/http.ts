/**
 * Shared HTTP helpers: timeout, retries with exponential backoff, clearer errors.
 */

export class HttpRequestError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly bodySnippet: string;
  readonly code = "HTTP_REQUEST_ERROR" as const;

  constructor(opts: {
    status: number;
    statusText: string;
    url: string;
    bodySnippet?: string;
    message?: string;
  }) {
    const snippet = (opts.bodySnippet ?? "").slice(0, 500);
    super(
      opts.message ??
        `HTTP ${opts.status} ${opts.statusText} at ${opts.url}${snippet ? `: ${snippet}` : ""}`
    );
    this.name = "HttpRequestError";
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.url = opts.url;
    this.bodySnippet = snippet;
  }
}

export function httpTimeoutMs(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const raw = process.env.AI2LIVE_HTTP_TIMEOUT_MS;
  if (!raw) return 60_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

export function httpMaxRetries(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  const raw = process.env.AI2LIVE_HTTP_MAX_RETRIES;
  if (!raw) return 2;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FetchWithRetryOptions {
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  /** Called before each retry (after a failed attempt). */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

/**
 * fetch with AbortSignal timeout + exponential backoff on retryable failures.
 * Does not retry on 4xx except 408/429.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchWithRetryOptions = {}
): Promise<Response> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error("fetch is not available in this runtime");
  }
  const timeoutMs = httpTimeoutMs(opts.timeoutMs);
  const maxRetries = httpMaxRetries(opts.maxRetries);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Combine with caller signal if present
    const callerSignal = init.signal;
    const onAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const res = await fetchFn(url, { ...init, signal: controller.signal });
      if (!res.ok && isRetryableStatus(res.status) && attempt < maxRetries) {
        const delayMs = Math.min(8_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
        opts.onRetry?.({
          attempt: attempt + 1,
          delayMs,
          reason: `HTTP ${res.status}`,
        });
        await sleep(delayMs);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      const name = err instanceof Error ? err.name : "";
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        name === "AbortError" ||
        /network|ECONNRESET|ETIMEDOUT|fetch failed|socket/i.test(message);
      if (retryable && attempt < maxRetries) {
        const delayMs = Math.min(8_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
        opts.onRetry?.({
          attempt: attempt + 1,
          delayMs,
          reason: name === "AbortError" ? `timeout after ${timeoutMs}ms` : message,
        });
        await sleep(delayMs);
        continue;
      }
      if (name === "AbortError") {
        throw new HttpRequestError({
          status: 0,
          statusText: "Timeout",
          url,
          message: `Request timed out after ${timeoutMs}ms (AI2LIVE_HTTP_TIMEOUT_MS) at ${url}`,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Read response body and throw HttpRequestError if !ok. */
export async function assertOk(res: Response, url: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new HttpRequestError({
    status: res.status,
    statusText: res.statusText,
    url,
    bodySnippet: body,
  });
}
