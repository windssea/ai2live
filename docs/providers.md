# Model providers — configuration

[English](#english) | [中文](#中文)

## English

`ai2live` uses a **pluggable model execution layer** (`@ai2live/model-providers`).  
The LLM is for **planning / diagnosis text only**. Compile, QC, hashes, PSD naming stay deterministic code paths.

### Switch provider

```bash
export AI2LIVE_MODEL_PROVIDER=grok    # default
# export AI2LIVE_MODEL_PROVIDER=openai
# export AI2LIVE_MODEL_PROVIDER=codex

ai2live providers
ai2live agent plan ./examples/simple-character --provider grok
ai2live agent diagnose ./examples/simple-character --provider openai
```

### Dry-run (no API key / no network)

```bash
export AI2LIVE_MODEL_DRY_RUN=1
ai2live agent plan ./examples/simple-character
```

Returns a deterministic mock JSON plan. Use this in CI and local smoke tests.

---

### 1. Grok (default — xAI)

| Env | Purpose | Default |
|-----|---------|---------|
| `AI2LIVE_GROK_API_KEY` or `XAI_API_KEY` | Auth | — |
| `AI2LIVE_GROK_BASE_URL` | API base | `https://api.x.ai/v1` |
| `AI2LIVE_GROK_MODEL` | Chat model | `grok-2-latest` |

```bash
export AI2LIVE_MODEL_PROVIDER=grok
export AI2LIVE_GROK_API_KEY=xai-...
# optional:
# export AI2LIVE_GROK_MODEL=grok-2-latest
# export AI2LIVE_GROK_BASE_URL=https://api.x.ai/v1

ai2live agent plan ./examples/simple-character
```

OpenAI-compatible `POST /chat/completions` client (shared with OpenAI provider).

Without a key and without dry-run: `ProviderNotConfiguredError` with setup hints.

---

### 2. OpenAI (ChatGPT)

| Env | Purpose | Default |
|-----|---------|---------|
| `AI2LIVE_OPENAI_API_KEY` or `OPENAI_API_KEY` | Auth | — |
| `AI2LIVE_OPENAI_BASE_URL` | API base | `https://api.openai.com/v1` |
| `AI2LIVE_OPENAI_MODEL` | Chat model | `gpt-4o` |

```bash
export AI2LIVE_MODEL_PROVIDER=openai
export OPENAI_API_KEY=sk-...
# optional: AI2LIVE_OPENAI_MODEL=gpt-4.1

ai2live agent diagnose ./examples/simple-character --provider openai
```

Same HTTP client shape as Grok — swap provider without rewriting the pipeline.

---

### 3. Codex (local CLI — not OpenAI cloud by default)

Runs a **local Codex binary**; stdout is treated as the completion. Designed so a later local agent can edit the project / run tools.

| Env | Purpose | Default |
|-----|---------|---------|
| `AI2LIVE_CODEX_BIN` | Executable path or name | `codex` |

```bash
# Install Codex CLI separately, then:
export AI2LIVE_MODEL_PROVIDER=codex
export AI2LIVE_CODEX_BIN=codex   # or absolute path / npx wrapper

ai2live agent plan ./examples/simple-character --provider codex
```

If the binary is missing: `ProviderBinaryMissingError` + install/config hints.  
Dry-run still works without installing Codex.

---

### Programmatic API

```ts
import {
  createProvider,
  resolveProviderId,
  listProviders,
} from "@ai2live/model-providers";

const id = resolveProviderId();          // from env, default "grok"
const provider = createProvider(id);
const result = await provider.chat({
  messages: [{ role: "user", content: "…" }],
  response_format: "json",
});
```

`AgentContext.provider` in `@ai2live/agent-runtime` is the same `ModelProvider`.

---

## 中文

`ai2live` 通过 **可插拔模型层**（`@ai2live/model-providers`）接入 LLM。  
**原则**：Agent 负责策略/诊断文案；编译、QC、哈希、PSD 命名仍走确定性代码，换模型不必改管线。

### 切换与干跑

```bash
export AI2LIVE_MODEL_PROVIDER=grok|openai|codex   # 默认 grok
export AI2LIVE_MODEL_DRY_RUN=1                    # 无密钥时的确定性 mock

ai2live providers
ai2live agent plan <项目目录> --provider grok
ai2live agent diagnose <项目目录> --provider openai
```

### Grok（本地默认）

- 密钥：`AI2LIVE_GROK_API_KEY` 或 `XAI_API_KEY`
- 地址：`AI2LIVE_GROK_BASE_URL`（默认 `https://api.x.ai/v1`）
- 模型：`AI2LIVE_GROK_MODEL`（默认 `grok-2-latest`）

### OpenAI（ChatGPT）

- 密钥：`AI2LIVE_OPENAI_API_KEY` 或 `OPENAI_API_KEY`
- 地址：`AI2LIVE_OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`）
- 模型：`AI2LIVE_OPENAI_MODEL`（默认 `gpt-4o`）

### Codex（本地 CLI）

- **默认不打 OpenAI 云端**；对本地 `codex`（或 `AI2LIVE_CODEX_BIN`）做 shell 适配，stdout 作为 completion。
- 二进制缺失会给出清晰错误与安装说明；可先用 `AI2LIVE_MODEL_DRY_RUN=1`。

详细英文表见上方。更多端到端步骤见 [usage.md](./usage.md) / [使用说明.md](./使用说明.md)。
