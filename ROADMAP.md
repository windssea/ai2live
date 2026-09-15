# Roadmap

## M0 — Deterministic Layer Package

Hand-authored RGBA + LayerManifest → PSD → adapter packages + static QC.

## M1 — Master → Mask → PSD

See-through / stub segmentation (`ai2live segment`) writing `masks/` + draft layers.

## M2 — Occlusion Completion

Three scenarios via `ai2live occlusion`: bangs under face, face over back hair, body over arm root.

## M3 — Expression Differentials

`ai2live expressions`: mouth open, eye close, smile, special eye (full-character differentials).

## M4 — Agent Repair Loop

`ai2live repair`: pose grid stubs, diagnosis hooks, repair plan (no blind STALE_HEAD retries).

## M5 — psd2live Deep Integration

`ai2live downstream --deep`: external MCP/CLI session script only — **no GPL copy**.

## M6 — Unattended Product

`ai2live unattended`: budget/retry/handoff stubs + default plan + smoke eval.
