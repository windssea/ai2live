# AI Live2D Asset Compiler (`ai2live`)

[中文](#中文) | [English](#english)

## 中文

从 **文本或一张角色设定图** 编译 Live2D 向资产的确定性管线。

**主产物：分层 PSD**（`exports/<name>_layers.psd`），并附带 AutoLive2d / psd2live 导入包、质检闸门与统一控制台。  
模型可插拔：默认 **Grok**，可换 **OpenAI / ChatGPT** 或 **本地 Codex**。

> 使用文档已按 2026-09-15（PR #1–#14）实现校准。  
> **遗留问题（外部依赖等）→ [docs/遗留问题.md](docs/遗留问题.md)**  
> 验收状态 → [docs/DOD_STATUS.md](docs/DOD_STATUS.md)

### 快速开始

```bash
pnpm install && pnpm -r build
pnpm --filter @ai2live/studio dev
# http://127.0.0.1:5173 → 导入设定图 → 一键完成全部 → 下载 PSD
```

CLI：

```bash
export AI2LIVE_MODEL_DRY_RUN=1
pnpm ai2live -- run ./my-char --from-image ./design.png --dry-run
pnpm ai2live -- doctor
pnpm ai2live -- eval
```

LEFT/RIGHT = **角色自身左右**。不 vendor psd2live GPL 源码。

### 文档

| 文档 | 说明 |
|------|------|
| [使用说明](docs/使用说明.md) | 怎么用（中文主文档） |
| [Usage](docs/usage.md) | English usage |
| [遗留问题](docs/遗留问题.md) | **标准遗留 / 外部阻塞清单** |
| [providers](docs/providers.md) | 模型与环境变量 |
| [DESIGN_COMPLETION](docs/DESIGN_COMPLETION.md) | 完成度总结 |
| [DOD_STATUS](docs/DOD_STATUS.md) | DESIGN §26 条目状态 |
| [DESIGN](docs/DESIGN.md) | 原始设计 |
| [ROADMAP](ROADMAP.md) | 里程碑 |

### 许可证

Apache-2.0（[LICENSE](./LICENSE)）。

---

## English

Deterministic **text / one design image → layered PSD (primary) → AutoLive2d / psd2live packages** pipeline with Studio console, quality gates, and pluggable **Grok / OpenAI / Codex** providers.

Docs calibrated to 2026-09-15 (PR #1–#14).  
**Known issues → [docs/遗留问题.md](docs/遗留问题.md)** · DoD → [docs/DOD_STATUS.md](docs/DOD_STATUS.md)

```bash
pnpm install && pnpm -r build
pnpm --filter @ai2live/studio dev
export AI2LIVE_MODEL_DRY_RUN=1
pnpm ai2live -- run ./my-char --from-image ./design.png --dry-run
```

License: Apache-2.0. Do not vendor psd2live GPL sources.
