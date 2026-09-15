# Usage guide — ai2live

[English](#english) | [中文见 使用说明.md](./使用说明.md)

## English

### Single design image → Live2D (primary path)

From **one character design/reference PNG** to layered PSD + AutoLive2d + psd2live packages — no hand-authored layer tree required.

#### Studio console (recommended)

```bash
pnpm install && pnpm -r build
pnpm --filter @ai2live/studio dev
# open http://127.0.0.1:5173
```

1. **Import design image** (upload or local path)
2. Pick provider (`grok` default); enable **dry-run** without API keys
3. Click **Run All / 一键完成全部**
4. Inspect live step progress, log, and artifact paths (PSD / adapters / `pipeline_report.json`)

#### CLI one-shot

```bash
export AI2LIVE_MODEL_DRY_RUN=1
ai2live run ./my-character --from-image ./design.png --dry-run --provider grok
```

Outputs:

- `psd/character.psd` + import manifest
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
```
