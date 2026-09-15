# Usage guide — ai2live

[English](#english) | [中文见 使用说明.md](./使用说明.md)

## English

End-to-end how to install, build, run the example project, and use model providers.

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

If layer PNGs are missing under `examples/simple-character`:

```bash
node examples/simple-character/generate-assets.mjs
```

### 3. Compile & validate (deterministic pipeline)

```bash
pnpm --filter @ai2live/cli exec node dist/cli.js compile ../../examples/simple-character
pnpm --filter @ai2live/cli exec node dist/cli.js validate ../../examples/simple-character
```

Or via root scripts:

```bash
pnpm compile:example
pnpm validate:example
```

### 4. Milestone tool commands

```bash
ai2live segment <project> [--feather N] [--split-bilateral] [--debug]  # M1 see-through + QC
ai2live occlusion <project>     # M2 occlusion completion stubs
ai2live expressions <project>   # M3 expression differentials
ai2live repair <project>        # M4 pose grid + diagnosis
ai2live repair <project> --loop
ai2live downstream <project>    # M5 adapter packages
ai2live downstream <project> --deep
ai2live unattended <project>    # M6 full deterministic plan
```

### 5. Model providers (planning / diagnosis / repair)

```bash
ai2live providers

export AI2LIVE_MODEL_DRY_RUN=1
ai2live agent plan ../../examples/simple-character
ai2live agent diagnose ../../examples/simple-character
ai2live agent repair ../../examples/simple-character --apply-stub
```

Writes:

- `validation/llm_plan.json`
- `validation/llm_diagnosis.json`
- `validation/repair_plan.json` (+ `validation/history.json` for agent repair)

### 6. Image edit

```bash
export AI2LIVE_MODEL_DRY_RUN=1
ai2live image edit \
  --prompt "fix bangs slightly" \
  --input ../../examples/simple-character/layers/front_hair.png \
  --project ../../examples/simple-character \
  --provider grok
```

Optional Python worker:

```bash
PYTHONPATH=services/image-worker-python/src python -m ai2live_worker.main --port 8090
export AI2LIVE_IMAGE_WORKER_URL=http://127.0.0.1:8090
```

### 7. MCP server (stdio JSON-RPC)

```bash
pnpm --filter @ai2live/mcp-server exec node dist/index.js
# tools: compile, validate, providers, agent_plan
```

Send newline-delimited JSON-RPC (`initialize`, `tools/list`, `tools/call`).


### 8. Doctor (env / provider / worker)

```bash
ai2live doctor
ai2live doctor --json
```

Checks whether API keys are **set** (never prints values), whether the active provider looks configured, and whether `AI2LIVE_IMAGE_WORKER_URL` `/health` is reachable. See `.env.example`.

### 9. Segmentation options

```bash
ai2live segment <project> --feather 2 --split-bilateral --debug
# writes masks/, masks/segmentation_report.json (incl. coverage QC),
# and previews/seg_debug.png when --debug
```

### 10. Studio (local web UI)

```bash
pnpm -r build
pnpm --filter @ai2live/studio dev
# UI http://127.0.0.1:5173  — open examples/simple-character, run compile/validate/segment
```

Prefs: `localStorage` + `<project>/.ai2live-studio.json` (provider + dry-run).

### CLI surface

```text
ai2live compile|validate|segment|occlusion|expressions|repair|downstream|unattended <project>
ai2live doctor [--json]
ai2live providers
ai2live agent plan|diagnose|repair <project> [--provider grok|openai|codex]
ai2live image edit --prompt … --input … [--out …] [--provider grok|openai] [--project …]
```

Full env table: [providers.md](./providers.md).
