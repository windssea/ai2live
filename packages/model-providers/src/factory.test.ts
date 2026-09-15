import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createProvider,
  resolveProviderId,
  listProviders,
  ProviderNotConfiguredError,
  ProviderBinaryMissingError,
  shapeChatPayload,
} from "./index.js";

const ENV_KEYS = [
  "AI2LIVE_MODEL_PROVIDER",
  "AI2LIVE_MODEL_DRY_RUN",
  "AI2LIVE_GROK_API_KEY",
  "XAI_API_KEY",
  "AI2LIVE_GROK_MODEL",
  "AI2LIVE_GROK_BASE_URL",
  "AI2LIVE_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "AI2LIVE_OPENAI_MODEL",
  "AI2LIVE_OPENAI_BASE_URL",
  "AI2LIVE_CODEX_BIN",
] as const;

describe("resolveProviderId", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to grok", () => {
    expect(resolveProviderId()).toBe("grok");
  });

  it("reads AI2LIVE_MODEL_PROVIDER", () => {
    process.env.AI2LIVE_MODEL_PROVIDER = "openai";
    expect(resolveProviderId()).toBe("openai");
  });

  it("explicit arg wins over env", () => {
    process.env.AI2LIVE_MODEL_PROVIDER = "openai";
    expect(resolveProviderId("codex")).toBe("codex");
  });

  it("rejects unknown ids", () => {
    expect(() => resolveProviderId("claude")).toThrow(/Unknown model provider/);
  });
});

describe("listProviders + dry-run", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("marks grok/openai unconfigured without keys", () => {
    const list = listProviders({ codexBin: "/nonexistent/codex-binary-xyz" });
    const grok = list.find((p) => p.id === "grok")!;
    const openai = list.find((p) => p.id === "openai")!;
    const codex = list.find((p) => p.id === "codex")!;
    expect(grok.configured).toBe(false);
    expect(openai.configured).toBe(false);
    expect(codex.configured).toBe(false);
  });

  it("dry-run marks all configured", () => {
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
    const list = listProviders({ codexBin: "/nonexistent/codex-binary-xyz" });
    expect(list.every((p) => p.configured)).toBe(true);
  });
});

describe("dry-run chat mocks", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AI2LIVE_MODEL_DRY_RUN = "1";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("grok dry-run returns deterministic json", async () => {
    const p = createProvider("grok");
    const r = await p.chat({
      messages: [{ role: "user", content: "plan a compile" }],
      response_format: "json",
    });
    expect(r.provider).toBe("grok");
    expect(r.model).toBe("grok-2-latest");
    const parsed = JSON.parse(r.text);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.provider).toBe("grok");
  });

  it("openai dry-run text mode", async () => {
    const p = createProvider("openai");
    const r = await p.chat({
      messages: [{ role: "user", content: "hello" }],
    });
    expect(r.provider).toBe("openai");
    expect(r.text).toContain("dry-run:openai");
    expect(r.text).toContain("Echo: hello");
  });

  it("codex dry-run works without binary", async () => {
    const p = createProvider("codex", { codexBin: "/no/such/codex" });
    const r = await p.chat({
      messages: [{ role: "user", content: "diagnose" }],
      response_format: "json",
    });
    expect(r.provider).toBe("codex");
    expect(JSON.parse(r.text).dry_run).toBe(true);
  });
});

describe("not configured errors", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("grok throws ProviderNotConfiguredError without key", async () => {
    const p = createProvider("grok");
    await expect(
      p.chat({ messages: [{ role: "user", content: "x" }] })
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it("openai throws ProviderNotConfiguredError without key", async () => {
    const p = createProvider("openai");
    await expect(
      p.chat({ messages: [{ role: "user", content: "x" }] })
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it("codex throws ProviderBinaryMissingError when binary missing", async () => {
    const p = createProvider("codex", { codexBin: "/nonexistent/codex-xyz-404" });
    await expect(
      p.chat({ messages: [{ role: "user", content: "x" }] })
    ).rejects.toBeInstanceOf(ProviderBinaryMissingError);
  });
});

describe("OpenAI-compat request shaping + mocked fetch", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("shapeChatPayload sets json_object format", () => {
    const payload = shapeChatPayload(
      {
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.2,
        response_format: "json",
      },
      "grok-2-latest"
    );
    expect(payload.model).toBe("grok-2-latest");
    expect(payload.temperature).toBe(0.2);
    expect(payload.response_format).toEqual({ type: "json_object" });
  });

  it("grok chat uses shared client with mocked fetch", async () => {
    process.env.AI2LIVE_GROK_API_KEY = "test-key";
    process.env.AI2LIVE_GROK_BASE_URL = "https://api.x.ai/v1";

    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.x.ai/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("grok-2-latest");
      expect(body.messages).toHaveLength(1);
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-key");
      return new Response(
        JSON.stringify({
          model: "grok-2-latest",
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const p = createProvider("grok", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await p.chat({
      messages: [{ role: "user", content: "ping" }],
      response_format: "json",
    });
    expect(r.text).toBe('{"ok":true}');
    expect(r.provider).toBe("grok");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("openai chat uses openai base url", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://api.openai.com/v1/chat/completions");
      return new Response(
        JSON.stringify({
          model: "gpt-4o",
          choices: [{ message: { content: "hi" } }],
        }),
        { status: 200 }
      );
    });
    const p = createProvider("openai", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await p.chat({ messages: [{ role: "user", content: "x" }] });
    expect(r.text).toBe("hi");
    expect(r.model).toBe("gpt-4o");
  });
});
