import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry, HttpRequestError, assertOk, httpTimeoutMs } from "./http.js";

describe("httpTimeoutMs", () => {
  const saved = process.env.AI2LIVE_HTTP_TIMEOUT_MS;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI2LIVE_HTTP_TIMEOUT_MS;
    else process.env.AI2LIVE_HTTP_TIMEOUT_MS = saved;
  });
  it("defaults to 60000", () => {
    delete process.env.AI2LIVE_HTTP_TIMEOUT_MS;
    expect(httpTimeoutMs()).toBe(60_000);
  });
  it("reads env", () => {
    process.env.AI2LIVE_HTTP_TIMEOUT_MS = "1234";
    expect(httpTimeoutMs()).toBe(1234);
  });
});

describe("fetchWithRetry", () => {
  it("returns on success", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await fetchWithRetry(
      "https://example.test/x",
      { method: "GET" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, maxRetries: 2 }
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 503 then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n < 3) return new Response("busy", { status: 503, statusText: "Unavailable" });
      return new Response("ok", { status: 200 });
    });
    const res = await fetchWithRetry(
      "https://example.test/x",
      { method: "GET" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, maxRetries: 3, timeoutMs: 5_000 }
    );
    expect(res.status).toBe(200);
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not retry 400", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400, statusText: "Bad" }));
    const res = await fetchWithRetry(
      "https://example.test/x",
      { method: "GET" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, maxRetries: 3 }
    );
    expect(res.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("assertOk", () => {
  it("throws HttpRequestError with snippet", async () => {
    const res = new Response('{"error":"nope"}', { status: 401, statusText: "Unauthorized" });
    await expect(assertOk(res, "https://api.example/v1/chat")).rejects.toBeInstanceOf(
      HttpRequestError
    );
    try {
      const res2 = new Response('{"error":"nope"}', { status: 401, statusText: "Unauthorized" });
      await assertOk(res2, "https://api.example/v1/chat");
    } catch (e) {
      const err = e as HttpRequestError;
      expect(err.status).toBe(401);
      expect(err.bodySnippet).toContain("nope");
      expect(err.message).toMatch(/401/);
    }
  });
});
