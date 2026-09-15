# Usage guide — ai2live

[English](#english) | [中文见 使用说明.md](./使用说明.md)

## English

### Single design image → Live2D (primary path)

From **one character design/reference PNG** to a **downloadable layered PSD (primary asset)** plus AutoLive2d / psd2live packages — no hand-authored layer tree required.

**Primary deliverable: layered PSD** (Photoshop / Live2D import):

- `exports/<character_or_project>_layers.psd` (preferred for download/distribution)
- `psd/character.psd` (pipeline working copy)
- `exports/import_manifest.json` (UUID ↔ PSD layer name map)

#### Studio console (recommended)

```bash
pnpm install && pnpm -r build
pnpm --filter @ai2live/studio dev
# open http://127.0.0.1:5173
```

1. **Import design image** (upload or local path)
2. Pick provider (`grok` default); enable **dry-run** without API keys
3. Click **Run All / 一键完成全部**
4. Download **PSD** from the Artifacts panel (「下载 PSD」), and inspect adapters / `pipeline_report.json`

#### CLI one-shot

```bash
export AI2LIVE_MODEL_DRY_RUN=1
ai2live run ./my-character --from-image ./design.png --dry-run --provider grok
```

Outputs (PSD is first-class):

- **`exports/<name>_layers.psd`** + `exports/import_manifest.json` (primary)
- `psd/character.psd` (working copy)
- AutoLive2d + psd2live deep session packages
- `validation/pipeline_report.json`

Dry-run / missing keys use a **deterministic anime upper-body template** for the layer plan. With Grok/OpenAI keys set, the planner can propose a better plan from image metadata.

Shared orchestrator: `@ai2live/pipeline` (`runFullPipeline`). Studio streams NDJSON events from `POST /api/pipeline`.

---

### Prerequisites

- Node.js **≥ 20**
- [pnpm](https://pnpm.io) **9.x** (repo pins `packageManager: pnpm@9.15.0`)

### 1. Install & build

```bash
git clone <repo-url> ai2live && cd ai2live
pnpm install
pnpm -r build
pnpm -r test
```

### 2. Example project assets

```bash
node examples/simple-character/generate-assets.mjs
```

### 3. Compile & validate (existing layered project)

```bash
pnpm compile:example
pnpm validate:example
```

### 4. Unified pipeline

```bash
ai2live run <project> [--from-image <png>] [--provider grok|openai|codex] [--dry-run]
ai2live run <project> --skip-segment --skip-repair --json-events
ai2live pipeline <project>    # alias of run
ai2live unattended <project>  # thin wrapper; prefer `run`
```

### 5. Milestone tools

```bash
ai2live segment <project> [--feather N] [--split-bilateral] [--debug]
ai2live occlusion|expressions|repair|downstream <project>
ai2live doctor [--json]
```

### 6. Model providers

```bash
ai2live providers
export AI2LIVE_MODEL_DRY_RUN=1
ai2live agent plan ../../examples/simple-character
ai2live agent diagnose ../../examples/simple-character
ai2live agent repair ../../examples/simple-character --apply-stub
```

### 7. Image edit / MCP / doctor

Same as before — see [providers.md](./providers.md).

### CLI surface

```text
ai2live run|pipeline <project> [--from-image] [--dry-run] [--provider] [--json-events]
ai2live compile|validate|segment|occlusion|expressions|repair|downstream|unattended <project>
ai2live doctor [--json]
ai2live providers
ai2live agent plan|diagnose|repair <project>
ai2live image edit --prompt … --input …
ai2live layer replace <project> <layerId> --png <path>
ai2live eval [--suite all|hair-stress|occlusion-stress|flat-image]
```

## Design-gap progress (Batch 1)

- Gate 6 PSD round-trip → `validation/psd_roundtrip.json`
- Occlusion: completion mask + imageEdit / neighbor-blend fallback (`completion_method`)
- Expressions: Edit Delta via imageEdit; dry-run ROI morph stub + provenance
- `ai2live agent repair --apply` / `run --apply-repair` → `validation/repair_result.json`
- Content-addressed layer hashes under `assets/sha256/` on compile

## Design-gap progress (Batch 2)

- Quality Gates 0–5 → `validation/quality_gates.json` (Gate 2 + Gate 4 real heuristics)
- MCP: inspect / compose / validate / downstream / revision
- CLI: `ai2live revision list|checkout|resume`
- Eval: `node evals/run-hair-stress.mjs`

## Design-gap progress (Batch 3)

- Min-region inpaint (`minRegionInpaint`): `image_edit` → `opencv_inpaint` / telea-like → `neighbor_blend`
- MCP §8 tools complete: `design`, `view`, `asset`, `layer`, `task`
- Gates 0 / 1 / 5 real heuristics in `validation/quality_gates.json`
- Downstream invoke smoke via `AI2LIVE_AUTOLIVE2D_CMD` / `AI2LIVE_PSD2LIVE_CMD` (else `invoke_skipped.json`)
- Pose QA: parameter-contract annotated composites + `pose_qa_findings.json`

## Design-gap progress (Batch 4)

- Evals: occlusion-stress + flat-image + `evals/run-all.mjs` / `ai2live eval` → `evals/last-report.json`
- Prompt layering: `@ai2live/prompt-layers` (Identity / Style / Rigability / EditDelta / Negatives)
- Human replace-and-continue: `ai2live layer replace <project> <layerId> --png <path>`
- Downstream: `invoke_log.json` + safe check when `AI2LIVE_*_CMD` set
- `pipeline_report.json`: provider, completion_method_histogram, asset_sha256_count, package_version

### CLI additions

```text
ai2live eval [--suite all|hair-stress|occlusion-stress|flat-image]
ai2live layer replace <project> <layerId> --png <path>
```

