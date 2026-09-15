# Roadmap

## M0 — Deterministic Layer Package

Hand-authored RGBA + LayerManifest → PSD → adapter packages + static QC.
**Progress:** Gate 6 PSD `readPsd` round-trip (`validation/psd_roundtrip.json`); content-addressed `assets/sha256/…` wired on compile into `import_manifest`.

## M1 — Master → Mask → PSD

See-through / stub segmentation (`ai2live segment`) writing `masks/` + draft layers.

## M2 — Occlusion Completion

Three scenarios via `ai2live occlusion`: bangs under face, face over back hair, body over arm root.
**Progress:** Completion mask = occluder dilated ∩ missing under-layer; prefer `provider.imageEdit`; fallback multi-scale neighbor blend (`completion_method`). Still heuristic vs full DESIGN inpaint.

## M3 — Expression Differentials

`ai2live expressions`: mouth open, eye close, smile, special eye (full-character differentials).
**Progress:** Edit-delta prompts via `provider.imageEdit`; dry-run shares path then ROI soft-morph stub; provenance (`prompt_hash`, `method`) on report.

## M4 — Agent Repair Loop

`ai2live repair` / `ai2live agent repair --apply`: pose grid stubs, LLM plan, **real apply** of ≥1 deterministic action (occlusion / feather / recompile) + re-QC → `validation/repair_result.json` + history revisions.

## M5 — psd2live Deep Integration

`ai2live downstream --deep`: external MCP/CLI session script only — **no GPL copy**.

## M6 — Unattended Product

`ai2live unattended` / `ai2live run`: budget/retry/handoff + pipeline; `--apply-repair` closes the repair loop when requested.

## Quality gates / MCP / history / evals (Batch 2)

- Gates 0–5 scaffolding with real Gate 2 visible-pixel fidelity + Gate 4 overlap heuristic; Gate 3 thresholds tightened; report in `validation/quality_gates.json`
- MCP tools: `inspect`, `compose`, `validate`, `downstream`, `revision` (+ legacy compile/providers/agent_plan)
- `ai2live revision list|checkout|resume` + HistoryStore.checkout
- Eval: `evals/hair-stress` + `evals/run-hair-stress.mjs` pass-rate report
