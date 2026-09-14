# AI Live2D Asset Compiler (`ai2live`)

[English](#english) | [中文](#中文)

## English

Deterministic **LayerManifest → PSD → AutoLive2d / psd2live** pipeline for Live2D-ready layered characters, plus M1–M6 scaffolding for segmentation, occlusion, expressions, repair, and unattended runs.

### Features

- JSON Schemas + validators; stable UUIDs; content-addressed `assets/sha256/ab/cd/...`
- PSD writer (`ag-psd`) with groups + `<semantic>_<side>_<index>__<short-id>` naming
- Static QC (recompose vs master)
- AutoLive2d + psd2live import packages (**no GPL vendoring**)
- CLI: `compile`, `validate`, `segment`, `occlusion`, `expressions`, `repair`, `downstream`, `unattended`
- Append-only history with `STALE_HEAD`; cost/retry/handoff stubs (M6)

LEFT/RIGHT always mean the **character’s own** left/right.

### Quick start

```bash
pnpm install
pnpm -r build
node examples/simple-character/generate-assets.mjs   # if PNGs missing
pnpm --filter @ai2live/cli exec node dist/cli.js compile ../../examples/simple-character
pnpm --filter @ai2live/cli exec node dist/cli.js validate ../../examples/simple-character
pnpm --filter @ai2live/cli exec node dist/cli.js unattended ../../examples/simple-character
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

面向 Live2D 的 **图层清单 → PSD → AutoLive2d / psd2live** 确定性编译管线，并含 M1–M6（分割、遮挡补全、表情差分、返修、无人值守）脚手架。

**LEFT/RIGHT = 角色自身左右**。psd2live 仅外部协议，不拷贝 GPL 代码。

快速开始见上方 English Quick start。
