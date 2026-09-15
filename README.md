# AI Live2D Asset Compiler (`ai2live`)

[中文](#中文) | [English](#english)

## 中文

面向 Live2D 的 **图层清单 → 分层 PSD（主产物）→ AutoLive2d / psd2live** 确定性编译管线，并含 M1–M6（分割、遮挡补全、表情差分、返修、无人值守）脚手架。  
一键跑通后优先得到可下载的 **`exports/<name>_layers.psd`**，再附带 Live2D 导入包。  
模型层可插拔：**本地默认 Grok**，之后可接 **ChatGPT / OpenAI** 或 **本地 Codex**，无需重写管线。

### 统一控制台：一张设定图 → PSD + Live2D

```bash
pnpm install && pnpm -r build
pnpm --filter @ai2live/studio dev   # http://127.0.0.1:5173 → 导入设定图 → 一键完成全部
# 或 CLI：
export AI2LIVE_MODEL_DRY_RUN=1
pnpm ai2live -- run ./my-char --from-image ./design.png --dry-run
```

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
pnpm compile:example
pnpm validate:example
# 或
pnpm compile:example && pnpm validate:example
```

### Doctor / 统一控制台 / 分割

```bash
pnpm ai2live -- doctor
pnpm ai2live -- run ./examples/simple-character --dry-run
pnpm ai2live -- segment ./examples/simple-character --feather 2 --split-bilateral --debug
pnpm --filter @ai2live/studio dev   # 统一控制台 http://127.0.0.1:5173
```

### 模型提供方（规划 / 诊断）

```bash
export AI2LIVE_MODEL_DRY_RUN=1          # 无密钥干跑
# export AI2LIVE_MODEL_PROVIDER=grok    # 默认；或 openai / codex
# export AI2LIVE_GROK_API_KEY=xai-...

pnpm ai2live -- providers
pnpm ai2live -- agent plan ./examples/simple-character
pnpm ai2live -- agent diagnose ./examples/simple-character
pnpm ai2live -- agent repair ./examples/simple-character --apply-stub
pnpm ai2live -- image edit --prompt "fix" --input ./in.png --provider grok --project ./examples/simple-character
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

Deterministic **LayerManifest → layered PSD (primary asset) → AutoLive2d / psd2live** pipeline for Live2D-ready characters, plus M1–M6 scaffolding. One-shot runs write **`exports/<name>_layers.psd`** as the first-class downloadable deliverable.  
**Pluggable models:** default **Grok** locally; plug in **ChatGPT/OpenAI** or **local Codex** later without rewriting the pipeline.

### Unified console: one design image → Live2D

```bash
pnpm install && pnpm -r build
pnpm --filter @ai2live/studio dev   # import design image → Run All
export AI2LIVE_MODEL_DRY_RUN=1
pnpm ai2live -- run ./my-char --from-image ./design.png --dry-run
```

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
pnpm ai2live -- doctor
pnpm ai2live -- providers
pnpm --filter @ai2live/studio dev
```

See [docs/usage.md](docs/usage.md) and [docs/providers.md](docs/providers.md).

**Changelog (deepen):** HTTP retries/timeouts/`ai2live doctor`/`.env.example`; segmentation feather/bilateral/debug/coverage QC; Studio Vite+React UI; Codex/`imageEdit`/`agent repair`/MCP/worker.

### License

Apache-2.0. Do not vendor psd2live GPL sources into this tree.
