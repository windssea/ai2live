# AI Live2D Asset Compiler (`ai2live`)

[English](#english) | [中文](#中文)

## English

Deterministic **LayerManifest → PSD → AutoLive2d / psd2live** pipeline for Live2D-ready layered characters.

### M0 status

- JSON Schemas + validators
- Stable UUIDs & content-addressed `assets/sha256/ab/cd/...`
- PSD writer (`ag-psd`) with groups + `<semantic>_<side>_<index>__<short-id>` naming
- Static QC (recompose vs master)
- AutoLive2d + psd2live **import packages** (psd2live = external protocol only, **no GPL vendoring**)
- CLI: `ai2live compile` / `ai2live validate`
- Append-only history with `STALE_HEAD`

LEFT/RIGHT always mean the **character’s own** left/right.

### Quick start

```bash
pnpm install
pnpm -r build
# generate example PNGs (once)
node examples/simple-character/generate-assets.mjs
pnpm --filter @ai2live/cli exec node dist/cli.js compile ../../examples/simple-character
pnpm --filter @ai2live/cli exec node dist/cli.js validate ../../examples/simple-character
pnpm -r test
```

### Docs

- [Architecture](docs/architecture.md)
- [Design summary](docs/design-summary.md)
- [Full design](docs/DESIGN.md)
- [Roadmap](ROADMAP.md)

### License

Apache-2.0 (see [LICENSE](./LICENSE)). Do not vendor psd2live GPL sources into this tree.

---

## 中文

面向 Live2D 的 **图层清单 → PSD → AutoLive2d / psd2live** 确定性编译管线。

### M0 能力

- Schema、稳定 UUID、内容寻址资产
- PSD 编译（分组 + 规范命名）
- 静态合成 QC
- 两个下游导入包（psd2live 仅外部协议，**不拷贝 GPL 代码**）
- CLI `compile` / `validate`
- 追加式历史 + `STALE_HEAD`

**LEFT/RIGHT = 角色自身左右**，不是观察者左右。

### 快速开始

见上方 English Quick start。设计文档见 `docs/`。
