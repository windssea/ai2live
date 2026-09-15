# Definition of Done Status

Auto/manual checklist mapped from `docs/DESIGN.md` §26 DoD + roadmap gates.
Updated: 2026-09-15 (batch8).

Legend: **DONE** | **PARTIAL** | **MISSING** | **EXTERNAL** (blocked on Cubism / psd2live / AutoLive2d binaries)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | User can create project from text or reference image | DONE | `ai2live init --text`, `ai2live run --from-image`, `packages/pipeline/src/init-from-text.ts`, `bootstrap.ts` |
| 2 | Agent produces Rig-friendly Master | PARTIAL | Synthetic SVG master from text; live image gen when provider keys + not dry-run |
| 3 | Automatic Layer Plan + Occlusion Graph | DONE | Template/LLM plan; `spec/occlusion_graph.json` with motion_risk/region_mask/completion_required |
| 4 | Visible-pixel-first extraction | DONE | Segmentation see-through + master pixel crop (`@ai2live/segmentation`) |
| 5 | Complete ≥3 hidden regions (face/hair/arm) | DONE | `ai2live occlusion` bangs/face/arm scenarios + minRegionInpaint |
| 6 | Auto eye-close / mouth-open differentials | DONE | `@ai2live/expression` |
| 7 | Normative PSD + Manifest | DONE | `@ai2live/psd-compiler`, Gate 6 round-trip |
| 8 | PSD round-trip no structure loss | DONE | `validation/psd_roundtrip.json` / Gate 6 |
| 9 | Auto send to ≥1 Rig backend | PARTIAL | Packages + mock runners; real binaries EXTERNAL |
| 10 | Neutral + extreme pose QA | DONE | `@ai2live/mock-rig-runtime` HeadX/Y warp; Gate 7 |
| 11 | Vision failure → layer/problem type | PARTIAL | Dual-judge + findings; live VLM when keys |
| 12 | ≥1 automatic repair round | DONE | `runRepairClosedLoop` + `--apply-repair` |
| 13 | Rollback / resume | DONE | History + `.ai2live/snapshots` + JSONL backend |
| 14 | Retry / cost / stop conditions | DONE | `@ai2live/product` StopConditionTracker; `validation/stop_conditions.json` |
| 15 | Final artifacts: provenance, version, report | DONE | `pipeline_report.json`, dual_judge, invoke_log |
| 16 | Dual AutoLive2d + psd2live backends | PARTIAL | Adapters + mock; live import EXTERNAL |
| 17 | psd2live CMO3/MOC3 export | EXTERNAL | Requires GPL psd2live binary |
| 18 | Eval dataset + pass-rate metrics | DONE | `evals/run-all.mjs` aggregate ≥95% |
| 19 | Human layer replace-and-continue | DONE | `ai2live layer replace` + Studio upload |
| 20 | Reproducible / traceable re-runs | DONE | Content-addressed assets + history revisions |

## Gates

| Gate | Status | Evidence |
|------|--------|----------|
| 0 Master bindability | DONE | `runGate0MasterBindability` |
| 1 Layer plan | DONE | `runGate1LayerPlan` |
| 2 Visible pixel fidelity | DONE | `runGate2VisiblePixelFidelity` |
| 3 Composite fidelity | DONE | static QC MAE/MSE |
| 4 Overlap sufficiency | DONE | `runGate4OverlapSufficiency` |
| 5 Generated region | DONE | `runGate5GeneratedRegion` |
| 6 PSD round-trip | DONE | psd-compiler validation |
| 7 Rig extreme pose | DONE | `runGate7RigExtremePose` + mock-rig |
| 8 Editability | DONE | `runGate8Editability` checklist |

## Defaults (batch8)

- `ai2live run`: vision-review dual-judge **on** (dry-run mock VLM), `AI2LIVE_USE_MOCK_RIG=1`
- Repair loop: max 3 attempts; stop when metric flat 2 rounds
