# @ai2live/studio

Minimal local web UI for ai2live projects (Vite + React + TypeScript).

## Dev

```bash
# from repo root (build CLI first so Studio can spawn it)
pnpm -r build
pnpm --filter @ai2live/studio dev
```

- UI: http://127.0.0.1:5173  
- API: http://127.0.0.1:5174 (proxied via `/api`)

Provider + dry-run prefs are stored in `localStorage` and written to `<project>/.ai2live-studio.json`.
