# Usage guide — ai2live

[中文：使用说明.md](./使用说明.md) · [Known issues：遗留问题.md](./遗留问题.md) · [DOD_STATUS.md](./DOD_STATUS.md) · [DESIGN_COMPLETION.md](./DESIGN_COMPLETION.md)

> Calibrated to **2026-09-15 / main (PR #1–#14)** — what works today, how to run it, and what remains external.

---

## 1. What it does

`ai2live` compiles Live2D-oriented assets from **text** or **one design image** into:

| Priority | Artifact | Path |
|----------|----------|------|
| Primary | Layered PSD | `exports/<name>_layers.psd` (+ working copy `psd/character.psd`) |
| Manifest | Import map | `exports/import_manifest.json` |
| Downstream | AutoLive2d / psd2live packages | `builds/…` (**mock backends by default**; real binaries optional) |
| Reports | Pipeline / QC / gates | `validation/pipeline_report.json`, etc. |

**LEFT/RIGHT = character’s own sides.** psd2live GPL sources are **never** vendored.

---

## 2. Install

Node ≥ 20, pnpm 9.x.

```bash
git clone https://github.com/windssea/ai2live.git && cd ai2live
pnpm install && pnpm -r build && pnpm -r test
pnpm ai2live -- doctor
```

Env template: [`.env.example`](../.env.example).

---

## 3. Primary path: one design image → PSD

### Studio

```bash
pnpm --filter @ai2live/studio dev   # http://127.0.0.1:5173
```

Import image → provider / dry-run → **Run All** → download PSD; inspect state machine & reports.

### CLI

```bash
export AI2LIVE_MODEL_DRY_RUN=1
pnpm ai2live -- run ./my-character --from-image ./design.png --dry-run --provider grok
```

Defaults: vision-review dual-judge on; `AI2LIVE_USE_MOCK_RIG=1` for pose/downstream without Cubism.

---

## 4. Text init

```bash
pnpm ai2live -- init ./my-character --text "front upper-body anime girl, clear face, bindable"
pnpm ai2live -- run ./my-character --dry-run
```

---

## 5. Existing layered project

```bash
node examples/simple-character/generate-assets.mjs
pnpm ai2live -- compile ./examples/simple-character
pnpm ai2live -- validate ./examples/simple-character
```

---

## 6. CLI map

```text
init | run/pipeline | unattended(deprecated→run)
compile | validate | segment | occlusion | expressions | repair | downstream
doctor | providers | status
agent plan|diagnose|repair
image edit
revision list|checkout|resume
layer replace
eval
```

---

## 7. Providers

| Id | Keys | Notes |
|----|------|-------|
| grok (default) | `AI2LIVE_GROK_API_KEY` / `XAI_API_KEY` | xAI OpenAI-compat |
| openai | `OPENAI_API_KEY` | Chat + Images |
| codex | `AI2LIVE_CODEX_BIN` | Local CLI |

Dry-run: `AI2LIVE_MODEL_DRY_RUN=1`. See [providers.md](./providers.md).

---

## 8. Evals

```bash
pnpm ai2live -- eval
# → evals/last-report.json (hair / occlusion / flat); target aggregate 100%
```

---

## 9. Known issues (summary)

In-repo DESIGN DoD has **no PARTIAL** rows. Remaining items are **EXTERNAL** or quality ceilings — full list in [遗留问题.md](./遗留问题.md):

1. Real Cubism / cmo3/moc3 via `AI2LIVE_PSD2LIVE_CMD`
2. Real AutoLive2d via `AI2LIVE_AUTOLIVE2D_CMD`
3. Production VLM/image quality needs API keys
4. Optional OpenCV TELEA for worker
5. Synthetic evals ≠ arbitrary commercial art zero-touch

---

## 10. Doc map

Usage (this file) · [使用说明.md](./使用说明.md) · [遗留问题.md](./遗留问题.md) · [DOD_STATUS](./DOD_STATUS.md) · [DESIGN_COMPLETION](./DESIGN_COMPLETION.md) · [DESIGN.md](./DESIGN.md) · [providers.md](./providers.md) · [mock-rig.md](./mock-rig.md) · [ROADMAP](../ROADMAP.md)
