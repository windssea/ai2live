# Design summary (condensed)

Full document: [DESIGN.md](./DESIGN.md).

## Product

**AI Live2D Asset Compiler / Rigging Agent** — from character intent to editable Live2D assets with QC and recoverable history.

## Core loop

Layer / Occlusion Manifest → RGBA layers → PSD → AutoLive2d (fast sanity) / psd2live (Cubism) → pose QA → repair.

## LayerManifest

Stable UUID per layer; semantic; **character-own** side; z-index; canvas bounds; source type; overlap hints; provenance.

## Quality gates

Master bindability → layer plan → visible fidelity → **composite fidelity** → overlap → generated consistency → PSD round-trip → rig pose → editability.

## Downstream

- **AutoLive2d**: Apache-2.0 friendly adapter for fast validation.
- **psd2live**: GPL — call out-of-process only; never copy into this repo.


## Batch 5 additions

- **State machine (§17):** `@ai2live/state-machine` → `.ai2live/state.json`; `ai2live status`
- **Snapshots:** `.ai2live/snapshots/<rev>/` restored by `ai2live revision checkout`
- **Dual-judge (§16):** `@ai2live/vision-review` — VALIDATED iff CV∧VLM; dry-run VLM is MOCK_PASS
