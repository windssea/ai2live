# @ai2live/studio — 统一控制台

Local **Unified Console** for ai2live: one-click full pipeline from a character design image to Live2D-ready packages.

## Dev

```bash
# from repo root (build packages + CLI first)
pnpm -r build
pnpm --filter @ai2live/studio dev
```

- UI: http://127.0.0.1:5173  
- API: http://127.0.0.1:5174 (proxied via `/api`)

## Primary flow（一张设定图 → Live2D）

1. **导入设定图** (upload PNG or paste a local path)
2. Choose **provider** (default `grok`) and **dry-run** if no API key
3. Click **一键完成全部 / Run All**
4. Watch the step checklist + live log; download **PSD 分层文件（可导入 Live2D / Photoshop）** via **下载 PSD** on the right (also lists `psd/character.psd` and `exports/*.psd`)

`POST /api/pipeline` streams NDJSON `PipelineEvent`s (in-process `@ai2live/pipeline`, or CLI `--json-events` fallback). Cancel via `POST /api/pipeline/cancel`.

Prefs: `localStorage` + `<project>/.ai2live-studio.json`.
