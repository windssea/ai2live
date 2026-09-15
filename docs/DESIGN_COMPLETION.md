# DESIGN Completion Summary

Date: 2026-09-15  
Scope: In-repo implementation of `docs/DESIGN.md` through batches 1–9.

## Fully met (in-repo)

- Character/project bootstrap from **text** (`ai2live init --text`) and **reference image**
- **Rig-friendly synthetic master** (Gate 0 hard-enough): transparent canvas, L/R labels, separate face/hair/body hues, upper-body layout guides; optional live `imageEdit` refine
- LayerManifest, occlusion graph (richer fields), segmentation, occlusion completion, expressions
- PSD compile + import manifests + static QC + Gates 0–8 (Gate 7/8 via mock-rig / checklist)
- Prompt layering, min-region inpaint (image_edit → opencv/telea → neighbor_blend) + A/B metrics
- Dual-judge vision review (live when API keys; MOCK_PASS dry-run)
- **Failure localization** → `validation/failure_localization.json` (`layer_id` + §7.13 `problem_type`)
- State machine + Studio handoff / layer replace UI
- History with snapshots + optional JSONL append backend
- Pipeline `ai2live run` with budget/retry/stop conditions + mock-rig defaults
- **Dual mock backends first-class**: `builds/autolive2d/` + `builds/psd2live/` always get `invoke_result.json` when real CMD unset
- Evals aggregate ≥95% (hair / occlusion / flat-image)

## External-blocked (honest)

| Capability | Blocker | In-repo substitute |
|------------|---------|-------------------|
| Live Cubism / moc3 pose renders | Cubism SDK / Editor not vendored | `@ai2live/mock-rig-runtime` mesh-warp pose grid |
| Real AutoLive2d import | Binary not present (`AI2LIVE_AUTOLIVE2D_CMD`) | `scripts/mock-rig/autolive2d-mock.mjs` (DoD-valid) |
| Real psd2live CMO3/MOC3 | GPL binary not vendored (`AI2LIVE_PSD2LIVE_CMD`) | `scripts/mock-rig/psd2live-mock.mjs` + deep session script |
| Production image / VLM quality | Provider API keys + spend | Dry-run mocks; live path when configured |
| OpenCV TELEA in CI | Optional `opencv-python-headless` | Pure-Python telea-like + TS neighbor_blend |

## How to unlock EXTERNAL items

```bash
export AI2LIVE_AUTOLIVE2D_CMD='autolive2d'
export AI2LIVE_PSD2LIVE_CMD='psd2live'   # installed separately; never vendored
export AI2LIVE_GROK_API_KEY=...          # or OpenAI
export AI2LIVE_VLM_LIVE=1                # force live vision review
pip install 'ai2live-image-worker[opencv]'  # optional worker extras
```

See also: `docs/mock-rig.md`, `docs/DOD_STATUS.md`, `ROADMAP.md`.

## 遗留问题文档

标准遗留 / 外部阻塞清单（给使用与排期）：[`遗留问题.md`](./遗留问题.md)。
使用入口：[使用说明.md](./使用说明.md)。
