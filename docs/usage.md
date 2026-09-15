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

Outputs (among others):

- `examples/simple-character/psd/character.psd`
- `examples/simple-character/psd/import_manifest.json`
- `examples/simple-character/validation/report.json`
- `examples/simple-character/builds/autolive2d/…`
- `examples/simple-character/builds/psd2live/…`

### 4. Milestone tool commands

```bash
ai2live segment <project>       # M1 see-through / stub masks
ai2live occlusion <project>     # M2 occlusion completion stubs
ai2live expressions <project>   # M3 expression differentials
ai2live repair <project>        # M4 pose grid + diagnosis
ai2live repair <project> --loop
ai2live downstream <project>    # M5 adapter packages
ai2live downstream <project> --deep
ai2live unattended <project>    # M6 full deterministic plan
```

(`ai2live` = `pnpm --filter @ai2live/cli exec node dist/cli.js …` after build.)

### 5. Model providers (planning / diagnosis)

List configuration status:

```bash
ai2live providers
```

Dry-run without API keys:

```bash
export AI2LIVE_MODEL_DRY_RUN=1
ai2live agent plan ../../examples/simple-character
ai2live agent diagnose ../../examples/simple-character
```

Writes:

- `validation/llm_plan.json`
- `validation/llm_diagnosis.json`

Real Grok (default locally):

```bash
export AI2LIVE_MODEL_PROVIDER=grok
export AI2LIVE_GROK_API_KEY=xai-...
ai2live agent plan ../../examples/simple-character --provider grok
```

ChatGPT / OpenAI later:

```bash
export AI2LIVE_MODEL_PROVIDER=openai
export OPENAI_API_KEY=sk-...
ai2live agent diagnose ../../examples/simple-character --provider openai
```

Local Codex:

```bash
export AI2LIVE_MODEL_PROVIDER=codex
export AI2LIVE_CODEX_BIN=codex
ai2live agent plan ../../examples/simple-character --provider codex
```

Full env table: [providers.md](./providers.md).

### 6. Design reminder

**Agent = strategy; programs = geometry.**  
UUIDs, Z-order, PSD naming, content hashes, and static QC are never delegated to the LLM. Swap Grok → OpenAI → Codex without rewriting the compile pipeline.

### CLI surface

```text
ai2live compile|validate|segment|occlusion|expressions|repair|downstream|unattended <project>
ai2live providers
ai2live agent plan <project> [--provider grok|openai|codex] [--prompt …] [-o file]
ai2live agent diagnose <project> [--provider …] [--prompt …] [-o file]
```

Run `ai2live --help` / `ai2live agent --help` for the live help text.
