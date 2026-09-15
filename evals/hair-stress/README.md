# Hair Stress Eval

Synthetic dense-bangs fixture for DESIGN §19 hair stress.

## Fixture notes (batch5)

- Dense front hair over incomplete forehead (occlusion bangs_under_face).
- Full anime upper-body semantics: FACE, BODY, FRONT_HAIR, BACK_HAIR, EYE×2, MOUTH, ARM×2
  so Gate 1 completeness can pass **without lowering** `ANIME_UPPER_BODY_REQUIRED_SEMANTICS`
  or Gate 1 error thresholds.
- **No Gate MAE/MSE / Gate 2 minRatio cheats** in this batch — reliability fix is fixture completeness.

```bash
pnpm -r build
node evals/run-hair-stress.mjs
# or
node evals/run-all.mjs
```

Writes `evals/hair-stress/validation/hair_stress_report.json` with per-check pass rates.
Target: **≥90%** aggregate checks.
