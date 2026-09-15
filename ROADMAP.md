# Roadmap

## M0 — Deterministic Layer Package

Hand-authored RGBA + LayerManifest → PSD → adapter packages + static QC.
**Progress:** Gate 6 PSD `readPsd` round-trip (`validation/psd_roundtrip.json`); content-addressed `assets/sha256/…` wired on compile into `import_manifest`.

## M1 — Master → Mask → PSD

See-through / stub segmentation (`ai2live segment`) writing `masks/` + draft layers.

## M2 — Occlusion Completion

Three scenarios via `ai2live occlusion`: bangs under face, face over back hair, body over arm root.
**Progress (batch3):** Min-region inpaint interface (`minRegionInpaint`) — live `image_edit` → worker `opencv_inpaint` / telea-like → `neighbor_blend`. Provenance `completion_method` on report.
**Progress (batch4):** Prompt layering (`@ai2live/prompt-layers`) for occlusion imageEdit; occlusion-stress eval suite.

## M3 — Expression Differentials

`ai2live expressions`: mouth open, eye close, smile, special eye (full-character differentials).
**Progress (batch3):** Feathered ROI mask + same min-region inpaint path; dry-run seeds ROI morph then inpaint.
**Progress (batch4):** Same prompt-layers builders (Identity/Style/Rigability/EditDelta/Negatives).

## M4 — Agent Repair Loop

`ai2live repair` / `ai2live agent repair --apply`: pose grid stubs, LLM plan, **real apply** of ≥1 deterministic action (occlusion / feather / recompile) + re-QC → `validation/repair_result.json` + history revisions.
**Progress (batch3):** Pose QA writes **parameter-contract screenshots** (annotated composites) + `pose_qa_findings.json` when no live renderer.

## M5 — psd2live Deep Integration

`ai2live downstream --deep`: external MCP/CLI session script only — **no GPL copy**.
**Progress (batch3/4):** `invokePsd2LiveSmoke` / `invokeAutoLive2dSmoke` — detect `AI2LIVE_*_CMD` env; write `invoke_log.json` + richer skipped reasons; **safe check** (`--help`/`--version`) when CMD set; else `invoke_skipped.json`.

## M6 — Unattended Product

`ai2live unattended` / `ai2live run`: budget/retry/handoff + pipeline; `--apply-repair` closes the repair loop when requested.
**Progress (batch4):** `pipeline_report.json` includes `provider`, `completion_method_histogram`, `asset_sha256_count`, `package_version` from root `package.json`.

## Quality gates / MCP / history / evals

### Batch 2
- Gates 0–5 scaffolding with real Gate 2 + Gate 4; MCP inspect/compose/validate/downstream/revision; hair-stress eval

### Batch 3 (~48–52% DoD)
- **Inpaint:** `@ai2live/image-client` `minRegionInpaint` + Python worker OpenCV/telea-like
- **MCP §8 complete:** `design`, `view`, `asset`, `layer`, `task` (+ existing)
- **Gates 0 / 1 / 5:** real heuristics (riggability, anime upper-body plan completeness, generated-region consistency)
- **Downstream invoke skeleton** + pose contract screenshots

### Batch 4
- **Evals:** `evals/occlusion-stress`, `evals/flat-image`, `evals/run-all.mjs` → `evals/last-report.json`; CLI `ai2live eval`
- **Prompt layering:** `@ai2live/prompt-layers` used by occlusion + expression imageEdit
- **Human replace-and-continue:** `ai2live layer replace <project> <layerId> --png <path>` (`@ai2live/layer-ops`)
- **Downstream provenance:** richer `invoke_log.json` + safe check when env CMD set
- **Pipeline report:** provider, completion_method histogram, asset sha256 counts, package version

## Remaining (post-batch4)
- Stronger CV segmentation; full Poisson/inpaint quality; VLM Gate 0; live Cubism pose renders; real AutoLive2d/psd2live import when binaries present
