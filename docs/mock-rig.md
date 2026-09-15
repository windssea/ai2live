# Mock Rig Runtime

When Cubism / AutoLive2d / psd2live binaries are unavailable, ai2live uses:

1. **`@ai2live/mock-rig-runtime`** — layered PNG mesh-ish warp for HeadX/Y/Z, mouth, eye-close pose grids (wired into `@ai2live/repair` pose QA).
2. **`scripts/mock-rig/autolive2d-mock.mjs`** / **`psd2live-mock.mjs`** — downstream smoke when `AI2LIVE_*_CMD` unset.

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `AI2LIVE_USE_MOCK_RIG` | `1` | Enable mock pose warp + mock downstream runners |
| `AI2LIVE_AUTOLIVE2D_CMD` | unset | Real AutoLive2d CLI (preferred over mock) |
| `AI2LIVE_PSD2LIVE_CMD` | unset | Real psd2live CLI (preferred over mock; never vendored) |
| `AI2LIVE_VLM_LIVE` | unset | Force live VLM review path when set |

Evals and CI should keep `AI2LIVE_USE_MOCK_RIG=1` and `AI2LIVE_MODEL_DRY_RUN=1`.
