# AI Live2D Asset Compiler (`ai2live`)

[中文](#中文) | [English](#english)

## 中文

面向 Live2D 的 **图层清单 → PSD → AutoLive2d / psd2live** 确定性编译管线，并含 M1–M6（分割、遮挡补全、表情差分、返修、无人值守）脚手架。  
模型层可插拔：**本地默认 Grok**，之后可接 **ChatGPT / OpenAI** 或 **本地 Codex**，无需重写管线。

**LEFT/RIGHT = 角色自身左右**。psd2live 仅外部协议，不拷贝 GPL 代码。

### 安装 / 构建 / 测试

```bash
pnpm install
pnpm -r build
pnpm -r test
```

### 示例：编译与校验

```bash
node examples/simple-character/generate-assets.mjs   # 若缺少 PNG
pnpm --filter @ai2live/cli exec node dist/cli.js compile ../../examples/simple-character
pnpm --filter @ai2live/cli exec node dist/cli.js validate ../../examples/simple-character
# 或
pnpm compile:example && pnpm validate:example
```

### Doctor / Studio / 分割

```bash
pnpm --filter @ai2live/cli exec node dist/cli.js doctor
pnpm --filter @ai2live/cli exec node dist/cli.js segment ../../examples/simple-character --feather 2 --split-bilateral --debug
pnpm --filter @ai2live/studio dev   # http://127.0.0.1:5173
```

### 模型提供方（规划 / 诊断）

```bash
export AI2LIVE_MODEL_DRY_RUN=1          # 无密钥干跑
# export AI2LIVE_MODEL_PROVIDER=grok    # 默认；或 openai / codex
# export AI2LIVE_GROK_API_KEY=xai-...

pnpm --filter @ai2live/cli exec node dist/cli.js providers
pnpm --filter @ai2live/cli exec node dist/cli.js agent plan ../../examples/simple-character
pnpm --filter @ai2live/cli exec node dist/cli.js agent diagnose ../../examples/simple-character
pnpm --filter @ai2live/cli exec node dist/cli.js agent repair ../../examples/simple-character --apply-stub
pnpm --filter @ai2live/cli exec node dist/cli.js image edit --prompt "fix" --input ./in.png --provider grok --project ../../examples/simple-character
```

### 文档

**Changelog (deepen):** HTTP 重试/超时/`doctor`/`.env.example`；分割 feather/bilateral/debug/coverage；Studio Vite UI；Codex/`imageEdit`/`agent repair`/MCP/worker。


- **[使用说明](docs/使用说明.md)** / [Usage (EN)](docs/usage.md)
- **[模型提供方配置](docs/providers.md)** — Grok / OpenAI / Codex、环境变量、干跑
- [架构](docs/architecture.md) · [设计摘要](docs/design-summary.md) · [完整设计](docs/DESIGN.md) · [路线图](ROADMAP.md)

### 许可证

Apache-2.0（见 [LICENSE](./LICENSE)）。勿将 psd2live GPL 源码 vendor 进本仓库。

---

## English

Deterministic **LayerManifest → PSD → AutoLive2d / psd2live** pipeline for Live2D-ready layered characters, plus M1–M6 scaffolding.  
**Pluggable models:** default **Grok** locally; plug in **ChatGPT/OpenAI** or **local Codex** later without rewriting the pipeline.

LEFT/RIGHT always mean the **character’s own** left/right.

### Install / build / test

```bash
pnpm install && pnpm -r build && pnpm -r test
```

### Compile & validate example

```bash
node examples/simple-character/generate-assets.mjs   # if PNGs missing
pnpm compile:example
pnpm validate:example
```

### Providers / doctor / studio

```bash
export AI2LIVE_MODEL_DRY_RUN=1
pnpm --filter @ai2live/cli exec node dist/cli.js doctor
pnpm --filter @ai2live/cli exec node dist/cli.js providers
pnpm --filter @ai2live/studio dev
```

See [docs/usage.md](docs/usage.md) and [docs/providers.md](docs/providers.md).

**Changelog (deepen):** HTTP retries/timeouts/`ai2live doctor`/`.env.example`; segmentation feather/bilateral/debug/coverage QC; Studio Vite+React UI; Codex/`imageEdit`/`agent repair`/MCP/worker.

### License

Apache-2.0. Do not vendor psd2live GPL sources into this tree.
