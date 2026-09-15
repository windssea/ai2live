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
**Progress (batch5):** Optional `--vision-review` dual-judge (CV + VLM dry-run mock) on pose QA / static QC.

## M5 — psd2live Deep Integration

`ai2live downstream --deep`: external MCP/CLI session script only — **no GPL copy**.
**Progress (batch3/4):** `invokePsd2LiveSmoke` / `invokeAutoLive2dSmoke` — detect `AI2LIVE_*_CMD` env; write `invoke_log.json` + richer skipped reasons; **safe check** (`--help`/`--version`) when CMD set; else `invoke_skipped.json`.

## M6 — Unattended Product

`ai2live unattended` / `ai2live run`: budget/retry/handoff + pipeline; `--apply-repair` closes the repair loop when requested.
**Progress (batch4):** `pipeline_report.json` includes `provider`, `completion_method_histogram`, `asset_sha256_count`, `package_version` from root `package.json`.
**Progress (batch5):** Pipeline advances `@ai2live/state-machine` → `.ai2live/state.json`; `ai2live status <project>`.

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

### Batch 5
- **Hair-stress ≥90%:** fixture enriched with EYE/MOUTH/ARM bilateral layers (no Gate threshold cheats); Gate 1 completeness + static QC
- **State machine (DESIGN §17):** `@ai2live/state-machine` + `.ai2live/state.json` + pipeline advance + `ai2live status`
- **Workspace snapshots:** `.ai2live/snapshots/<rev>/` for `spec/`, `layers/`, `validation/report.json`; `revision checkout` restores
- **Dual-judge skeleton (DESIGN §16):** `@ai2live/vision-review` — CV+VLM merge; dry-run VLM = MOCK_PASS; VALIDATED only if both pass; `--vision-review` on validate/repair/pipeline

## Remaining (honest PARTIAL)
- Live VLM Gate 0 / vision review (dry-run mock only unless credentials + `--vision-review` with `dryRun:false`)
- Stronger CV segmentation; full Poisson/inpaint quality
- Live Cubism pose renders (still parameter-contract composites)
- Real AutoLive2d/psd2live import when binaries present
- State machine does not yet drive branching UI / human handoff automation beyond persistence + CLI

### Batch 6
- **Live VLM path:** `@ai2live/vision-review` auto-live when API keys present (unless dry-run); structured JSON schema `VLM_REVIEW_JSON_SCHEMA` / `parseVlmReviewJson`
- **Stronger inpaint:** worker optional `[opencv]` extras; improved frontier-first telea-like; A/B helper `compareSeeThroughVsCompletion` / `runAbCompare`
- **`@ai2live/mock-rig-runtime`:** mesh-ish warp pose renderer for HeadX/Y extremes; pose QA prefers it when `AI2LIVE_USE_MOCK_RIG=1` (default)
- **Downstream mock runners:** `scripts/mock-rig/*-mock.mjs` invoked when real CMD unset + mock rig on

### Batch 7
- **Phase B text init:** `ai2live init --text "..."` → character_spec + synthetic SVG master + template layers
- **Occlusion graph v0.2:** motion_risk, region_mask, completion_required (+ schema)
- **History JSONL backend:** `AI2LIVE_HISTORY_BACKEND=jsonl|sqlite` → `.ai2live/history/events.jsonl` + index
- **Studio:** state machine panel + NEEDS_REVIEW handoff + layer replace upload

### Batch 8
- **DoD status:** `docs/DOD_STATUS.md` + `docs/DESIGN_COMPLETION.md`
- **Gates 7/8:** mock-rig extremes + editability checklist
- **Stop conditions:** max repair attempts + metric-flat stop in pipeline
- **`ai2live run` defaults:** vision-review dry-run dual-judge + mock rig on

