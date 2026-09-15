# Evals

| Set | Status | Entry |
|-----|--------|-------|
| Synthetic Clean | smoke | `node evals/run-smoke.mjs` (example compile) |
| Hair Stress | synthetic fixture | `node evals/run-hair-stress.mjs` |
| Occlusion Stress | synthetic fixture | `node evals/run-occlusion-stress.mjs` |
| Flat Image | generated PNGs → `--from-image --dry-run` | `node evals/run-flat-image.mjs` |

## Aggregate

```bash
pnpm -r build
node evals/run-all.mjs
# or
ai2live eval
```

Writes `evals/last-report.json` with per-suite and aggregate pass rates.

## Reports

- `evals/hair-stress/validation/hair_stress_report.json`
- `evals/occlusion-stress/validation/occlusion_stress_report.json`
- `evals/flat-image/validation/flat_image_report.json`
- `evals/last-report.json` (aggregate)
