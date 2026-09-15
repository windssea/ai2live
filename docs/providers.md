# Model providers — configuration

[English](#english) | [中文](#中文)

## English

`ai2live` uses a **pluggable model execution layer** (`@ai2live/model-providers`).  
The LLM is for **planning / diagnosis text only**. Compile, QC, hashes, PSD naming stay deterministic code paths.  
Image edit (Grok/OpenAI) uses the OpenAI-compatible **Images API** when configured; dry-run writes under `previews/`.

### Switch provider

```bash
export AI2LIVE_MODEL_PROVIDER=grok    # default
# export AI2LIVE_MODEL_PROVIDER=openai
# export AI2LIVE_MODEL_PROVIDER=codex

ai2live providers
ai2live agent plan ./examples/simple-character --provider grok
ai2live agent diagnose ./examples/simple-character --provider openai
ai2live agent repair ./examples/simple-character --provider grok --apply-stub
```

### HTTP client hardening

| Env | Purpose | Default |
|-----|---------|---------|
| `AI2LIVE_HTTP_TIMEOUT_MS` | Chat + Images request timeout | `60000` |
| `AI2LIVE_HTTP_MAX_RETRIES` | Retries on 408/429/5xx + network | `2` |

Optional SSE streaming: set `stream: true` on `ChatCompletionRequest` (accumulated client-side). Default is non-streaming for max xAI/OpenAI compatibility.

```bash
ai2live doctor          # keys present? provider configured? worker /health?
cp .env.example .env    # fill secrets locally — never commit
```

Live integration test (opt-in, skipped in CI by default):

```bash
AI2LIVE_LIVE_API_TEST=1 pnpm --filter @ai2live/model-providers test
```

### Dry-run (no API key / no network)

```bash
export AI2LIVE_MODEL_DRY_RUN=1
ai2live agent plan ./examples/simple-character
ai2live image edit --prompt "fix hair" --input ./in.png --project ./examples/simple-character --provider grok
```

Returns deterministic mock JSON / copies or writes a tiny PNG. Use this in CI and local smoke tests.

---

### 1. Grok (default — xAI)

| Env | Purpose | Default |
|-----|---------|---------|
| `AI2LIVE_GROK_API_KEY` or `XAI_API_KEY` | Auth | — |
| `AI2LIVE_GROK_BASE_URL` | API base | `https://api.x.ai/v1` |
| `AI2LIVE_GROK_MODEL` | Chat model | `grok-2-latest` |
| `AI2LIVE_GROK_IMAGE_MODEL` | Images edit model | same as chat model |

```bash
export AI2LIVE_MODEL_PROVIDER=grok
export AI2LIVE_GROK_API_KEY=xai-...
ai2live agent plan ./examples/simple-character
ai2live image edit --prompt "…" --input ./layer.png --provider grok --project ./examples/simple-character
```

OpenAI-compatible `POST /chat/completions` and (when supported) `POST /images/edits`.  
**Note:** xAI may not expose `/images/edits`; dry-run always works. Chat+vision fallback is documented but not auto-invoked yet.

Without a key and without dry-run: `ProviderNotConfiguredError` with setup hints.

---

### 2. OpenAI (ChatGPT)

| Env | Purpose | Default |
|-----|---------|---------|
| `AI2LIVE_OPENAI_API_KEY` or `OPENAI_API_KEY` | Auth | — |
| `AI2LIVE_OPENAI_BASE_URL` | API base | `https://api.openai.com/v1` |
| `AI2LIVE_OPENAI_MODEL` | Chat model | `gpt-4o` |
| `AI2LIVE_OPENAI_IMAGE_MODEL` | Images edit model | `dall-e-2` |

```bash
export AI2LIVE_MODEL_PROVIDER=openai
export OPENAI_API_KEY=sk-...
ai2live agent diagnose ./examples/simple-character --provider openai
ai2live image edit --prompt "…" --input ./layer.png --out ./previews/edit.png --provider openai
```

---

### 3. Codex (local CLI — not OpenAI cloud by default)

Runs a **local Codex binary**; stdout is treated as the completion.

| Env | Purpose | Default |
|-----|---------|---------|
| `AI2LIVE_CODEX_BIN` | Executable path or name | `codex` |
| `AI2LIVE_CODEX_ARGS` | Extra flags (JSON array or shell-split string) | — |
| `AI2LIVE_CODEX_CWD` | Working directory | request / provider `cwd` |
| `AI2LIVE_CODEX_TIMEOUT_MS` | Spawn timeout | `120000` |

Invocation prefers `codex exec --skip-git-repo-check` with the prompt on **stdin**. Alternate styles (`codex -`, prompt as argv) are available via `buildCodexArgv` for adapters/tests.

```bash
export AI2LIVE_MODEL_PROVIDER=codex
export AI2LIVE_CODEX_BIN=codex
export AI2LIVE_CODEX_ARGS='["--sandbox","read-only"]'
export AI2LIVE_CODEX_CWD=./examples/simple-character
export AI2LIVE_CODEX_TIMEOUT_MS=60000

ai2live agent plan ./examples/simple-character --provider codex
```

If the binary is missing: `ProviderBinaryMissingError` + install/config hints.  
Dry-run still works without installing Codex. Codex does **not** implement `imageEdit`.

---

### Image worker (optional HTTP)

```bash
export AI2LIVE_IMAGE_WORKER_URL=http://127.0.0.1:8090
# see services/image-worker-python/README.md
```

`@ai2live/image-client` posts to `/segment` and `/inpaint` when set; otherwise writes local stub masks.

---

### Programmatic API

```ts
import {
  createProvider,
  resolveProviderId,
  listProviders,
  buildCodexArgv,
} from "@ai2live/model-providers";

const id = resolveProviderId();
const provider = createProvider(id);
const result = await provider.chat({
  messages: [{ role: "user", content: "…" }],
  response_format: "json",
});
await provider.imageEdit?.({
  prompt: "fix bangs",
  inputImagePath: "./in.png",
  projectRoot: "./examples/simple-character",
});
```

---

## 中文

`ai2live` 通过 **可插拔模型层**（`@ai2live/model-providers`）接入 LLM。  
**原则**：Agent 负责策略/诊断文案；编译、QC、哈希、PSD 命名仍走确定性代码。

### 诊断与 HTTP

```bash
ai2live doctor
# AI2LIVE_HTTP_TIMEOUT_MS / AI2LIVE_HTTP_MAX_RETRIES
# 模板：.env.example
```

### 切换与干跑

```bash
export AI2LIVE_MODEL_PROVIDER=grok|openai|codex
export AI2LIVE_MODEL_DRY_RUN=1

ai2live providers
ai2live agent plan|diagnose|repair <项目目录> --provider grok
ai2live image edit --prompt "…" --input ./in.png --provider openai --project <项目>
```

### Codex 环境变量

- `AI2LIVE_CODEX_BIN` / `AI2LIVE_CODEX_ARGS` / `AI2LIVE_CODEX_CWD` / `AI2LIVE_CODEX_TIMEOUT_MS`

### 图像

- Grok/OpenAI：`imageEdit` → Images API；干跑写入 `previews/`
- 可选 Python worker：`AI2LIVE_IMAGE_WORKER_URL`

详细英文表见上方。更多端到端步骤见 [usage.md](./usage.md) / [使用说明.md](./使用说明.md)。
