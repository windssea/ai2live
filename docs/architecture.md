# Architecture — AI Live2D Asset Compiler

## Overview

`ai2live` is a **compiler + agent runtime** that turns a character plan into Live2D-ready layered assets.

```text
Character Spec / references
        ↓
LayerManifest (+ occlusion graph)
        ↓
RGBA layer package (content-addressed)
        ↓
PSD Compiler (ag-psd)
        ↓
Adapters: AutoLive2d | psd2live (external)
        ↓
QC (static composite → pose grid → repair)
```

## Design principles

1. **Original pixels first** — prefer extracting/completing over redrawing.
2. **Full-character differentials** before isolated part crops.
3. **Agent = strategy; programs = geometry** — UUIDs, Z-order, PSD, hashes are deterministic.
4. **LEFT/RIGHT = character-own sides** (psd2live-compatible), never viewer-left.
5. **Append-only history** with `expected_head` / `STALE_HEAD`.
6. **No GPL vendoring** — psd2live is an external process/MCP only.

## Packages (M0)

| Package | Role |
|---------|------|
| `domain` | Types, stable IDs, content-addressed paths, PSD naming |
| `manifest-schema` | AJV validators for JSON Schemas |
| `history` | Append-only revision store |
| `psd-compiler` | LayerManifest + PNGs → PSD + import_manifest |
| `qc-engine` | Static recompose vs master → `validation/report.json` |
| `autolive2d-adapter` | Import package under `builds/autolive2d/` |
| `psd2live-adapter` | External protocol package under `builds/psd2live/` |
| stubs | `agent-runtime`, `workflow-registry`, `image-client`, MCP, studio |

## Project layout on disk

See DESIGN §14.1. Key outputs: `psd/character.psd`, `psd/import_manifest.json`, `builds/*`, `validation/report.json`.

## Naming

PSD layer names: `<semantic>_<side>_<index>__<short-id>` (e.g. `front_hair_c_01__a91f`).

## Milestones

See [ROADMAP.md](../ROADMAP.md). Full design: [DESIGN.md](./DESIGN.md).
