import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPrefs, savePrefs, type StudioPrefs } from "./storage";

type Layer = {
  id: string;
  display_name: string;
  semantic: string;
  side: string;
  z_index: number;
  status?: string;
};

type StepStatus = "pending" | "running" | "ok" | "fail" | "skip" | "warn";

type ProjectPayload = {
  projectPath: string;
  layers: Layer[];
  character?: { name?: string; id?: string };
  validation?: unknown;
  pipelineReport?: {
    passed?: boolean;
    steps?: Array<{ id: string; status: string; message?: string }>;
    artifacts?: Record<string, string | undefined>;
  };
  segmentation?: unknown;
  settings?: { provider?: string; dryRun?: boolean };
  projectState?: {
    state?: string;
    updated_at?: string;
    history?: Array<{ to?: string; at?: string; reason?: string }>;
  } | null;
  handoff?: {
    reason?: string;
    blocking_findings?: string[];
    suggested_actions?: string[];
    timestamp?: string;
    resolved_layer_replace?: unknown;
  } | null;
  previewExists: Record<string, boolean>;
  previewUrls: Record<string, string | null>;
  artifactPaths?: Record<string, string | null | undefined>;
};

const STEP_DEFS: { id: string; label: string }[] = [
  { id: "bootstrap", label: "Bootstrap / 导入设定图" },
  { id: "doctor", label: "Doctor" },
  { id: "segment", label: "Segment" },
  { id: "occlusion", label: "Occlusion" },
  { id: "expressions", label: "Expressions" },
  { id: "compile", label: "Compile PSD" },
  { id: "qc", label: "Static QC" },
  { id: "pose", label: "Pose grid" },
  { id: "repair", label: "Agent repair" },
  { id: "downstream", label: "Downstream packages" },
  { id: "report", label: "Pipeline report" },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

export function App() {
  const prefs = loadPrefs();
  const [projectPath, setProjectPath] = useState(prefs.projectPath ?? "");
  const [provider, setProvider] = useState<StudioPrefs["provider"]>(
    (prefs.provider as StudioPrefs["provider"]) ?? "grok"
  );
  const [dryRun, setDryRun] = useState(prefs.dryRun ?? true);
  const [project, setProject] = useState<ProjectPayload | null>(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromImagePath, setFromImagePath] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [skip, setSkip] = useState<Record<string, boolean>>({
    repair: false,
    segment: false,
  });
  const [stepStatus, setStepStatus] = useState<Record<string, StepStatus>>(() =>
    Object.fromEntries(STEP_DEFS.map((s) => [s.id, "pending"]))
  );
  const [pipelineSummary, setPipelineSummary] = useState<string>("");
  const [replaceLayerId, setReplaceLayerId] = useState("");
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const persist = useCallback(
    (patch?: Partial<StudioPrefs>) => {
      const next: StudioPrefs = {
        projectPath,
        provider,
        dryRun,
        ...patch,
      };
      savePrefs(next);
    },
    [projectPath, provider, dryRun]
  );

  useEffect(() => {
    (async () => {
      try {
        const d = await api<{ exampleProject: string }>("/api/defaults");
        if (!projectPath) {
          setProjectPath(d.exampleProject);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProject = useCallback(
    async (pathOverride?: string) => {
      const p = pathOverride ?? projectPath;
      setBusy(true);
      setError(null);
      try {
        const data = await api<ProjectPayload>(
          `/api/project?path=${encodeURIComponent(p)}`
        );
        setProject(data);
        setProjectPath(data.projectPath);
        if (data.settings?.provider) {
          setProvider(data.settings.provider as StudioPrefs["provider"]);
        }
        if (typeof data.settings?.dryRun === "boolean") {
          setDryRun(data.settings.dryRun);
        }
        if (data.pipelineReport?.steps) {
          const next: Record<string, StepStatus> = Object.fromEntries(
            STEP_DEFS.map((s) => [s.id, "pending" as StepStatus])
          );
          for (const s of data.pipelineReport.steps) {
            const st = s.status as StepStatus;
            next[s.id] =
              st === "ok" || st === "fail" || st === "skip" || st === "warn"
                ? st
                : "pending";
          }
          setStepStatus(next);
          setPipelineSummary(JSON.stringify(data.pipelineReport, null, 2));
        }
        persist({ projectPath: data.projectPath });
        setLog((prev) => prev + `Opened ${data.projectPath}\n`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [projectPath, persist]
  );

  useEffect(() => {
    if (projectPath && !project) {
      void openProject(projectPath);
    }
  }, [projectPath, project, openProject]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const saveSettings = async () => {
    persist();
    await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath, provider, dryRun, skip }),
    });
    setLog((p) => p + `Saved settings\n`);
  };

  const onPickImage = async (file: File) => {
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const target =
      projectPath ||
      (await api<{ exampleProject: string }>("/api/defaults")).exampleProject.replace(
        "simple-character",
        file.name.replace(/\.\w+$/, "") || "from-image"
      );
    setProjectPath(target);
    const result = await api<{
      fromImage: string;
      projectPath: string;
      masterPath: string;
    }>("/api/import-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath: target,
        imageBase64: dataUrl,
      }),
    });
    setFromImagePath(result.fromImage);
    setCharacterName(file.name.replace(/\.\w+$/, ""));
    setLog(
      (p) =>
        p +
        `导入设定图 → ${result.masterPath}\n项目: ${result.projectPath}\n`
    );
    persist({ projectPath: result.projectPath });
  };

  const cancelPipeline = async () => {
    await api("/api/pipeline/cancel", { method: "POST", body: "{}" });
    setLog((p) => p + "Cancel requested\n");
  };

  const runAll = async () => {
    setBusy(true);
    setError(null);
    setStepStatus(Object.fromEntries(STEP_DEFS.map((s) => [s.id, "pending"])));
    setPipelineSummary("");
    try {
      await saveSettings();
      const body = {
        projectPath,
        provider,
        dryRun,
        fromImage: fromImagePath || undefined,
        characterName: characterName || undefined,
        skip,
        stream: true,
      };
      setLog((p) => p + `\n$ 一键完成全部 / Run All\n`);
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || res.statusText);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line) as {
              type: string;
              step?: string;
              message?: string;
              data?: unknown;
            };
            if (ev.type === "step_start" && ev.step) {
              setStepStatus((s) => ({ ...s, [ev.step!]: "running" }));
              setLog((p) => p + `→ ${ev.step}: ${ev.message ?? ""}\n`);
            } else if (ev.type === "step_end" && ev.step) {
              const st =
                (ev.data as { status?: StepStatus } | undefined)?.status ?? "ok";
              setStepStatus((s) => ({
                ...s,
                [ev.step!]:
                  st === "fail" || st === "skip" || st === "warn" || st === "ok"
                    ? st
                    : "ok",
              }));
              setLog((p) => p + `✓ ${ev.step}: ${ev.message ?? ""}\n`);
            } else if (ev.type === "log") {
              setLog((p) => p + `${ev.message ?? ""}\n`);
            } else if (ev.type === "error") {
              if (ev.step) {
                setStepStatus((s) => ({ ...s, [ev.step!]: "fail" }));
              }
              setLog((p) => p + `✗ ${ev.step ?? ""}: ${ev.message ?? ""}\n`);
            } else if (ev.type === "done") {
              setLog((p) => p + `done: ${ev.message ?? ""}\n`);
              if (ev.data) {
                setPipelineSummary(JSON.stringify(ev.data, null, 2));
              }
            }
          } catch {
            setLog((p) => p + line + "\n");
          }
        }
      }
      await openProject(projectPath);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importByPath = async () => {
    if (!fromImagePath.trim()) return;
    setBusy(true);
    try {
      const result = await api<{ fromImage: string; projectPath: string }>(
        "/api/import-image",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectPath,
            imagePath: fromImagePath.trim(),
          }),
        }
      );
      setFromImagePath(result.fromImage);
      setLog((p) => p + `设定图已就绪: ${result.fromImage}\n`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };


  const advanceFromHandoff = async (to = "REPAIRING") => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ state?: { state?: string } }>("/api/state/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath,
          to,
          reason: "studio_needs_review_continue",
        }),
      });
      setLog((p) => p + `State → ${r.state?.state ?? to}\n`);
      await openProject(projectPath);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onReplaceLayerFile = async (file: File) => {
    if (!replaceLayerId) {
      setError("Select a layer id first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await api("/api/layer/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath,
          layerId: replaceLayerId,
          pngBase64: dataUrl,
        }),
      });
      setLog((p) => p + `Replaced layer ${replaceLayerId} ← ${file.name}\n`);
      await openProject(projectPath);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const passed =
    project?.pipelineReport?.passed ??
    (project?.validation &&
    typeof project.validation === "object" &&
    project.validation !== null &&
    "passed" in project.validation
      ? Boolean((project.validation as { passed?: boolean }).passed)
      : null);

  const artifacts = useMemo(() => {
    const a = project?.pipelineReport?.artifacts ?? {};
    return Object.entries(a).filter(([, v]) => Boolean(v));
  }, [project]);

  const psdDownloads = useMemo(() => {
    const items: { label: string; path: string }[] = [];
    const arts = project?.pipelineReport?.artifacts ?? {};
    const paths = project?.artifactPaths ?? {};
    const exportPath = arts.psdExport || paths.psdExport;
    const workingPath = arts.psd || paths.psd;
    if (exportPath) {
      items.push({ label: "exports/*.psd（推荐下载）", path: exportPath });
    }
    if (workingPath && workingPath !== exportPath) {
      items.push({ label: "psd/character.psd", path: workingPath });
    }
    return items;
  }, [project]);

  const fileDownloadUrl = (filePath: string) =>
    `/api/file?path=${encodeURIComponent(filePath)}&download=1`;

  return (
    <div className="app console">
      <header>
        <div className="brand">
          <h1>ai2live 控制台</h1>
          <span className="subtitle">一张设定图 → Live2D · Unified Console</span>
        </div>
        <button
          className="run-all"
          disabled={busy || !projectPath}
          onClick={() => void runAll()}
          title="一键完成全部"
        >
          {busy ? "运行中…" : "一键完成全部 / Run All"}
        </button>
        {busy && (
          <button className="danger" onClick={() => void cancelPipeline()}>
            Cancel
          </button>
        )}
      </header>

      {error && <div className="banner err">{error}</div>}

      <div className="layout">
        <aside className="panel sidebar">
          <h2>项目 / 提供方</h2>
          <label className="field">
            <span>项目路径</span>
            <input
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="/path/to/project"
            />
          </label>
          <div className="row">
            <button disabled={busy} onClick={() => openProject()}>
              Open
            </button>
            <button
              disabled={busy}
              onClick={() =>
                api<{ exampleProject: string }>("/api/defaults").then((d) =>
                  openProject(d.exampleProject)
                )
              }
            >
              Example
            </button>
          </div>

          <h2>导入设定图</h2>
          <p className="muted">
            上传或指定一张角色设定/参考图，无需手写图层树。
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickImage(f);
            }}
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            导入设定图…
          </button>
          <label className="field">
            <span>或本地路径</span>
            <input
              value={fromImagePath}
              onChange={(e) => setFromImagePath(e.target.value)}
              placeholder="/path/to/character.png"
            />
          </label>
          <div className="row">
            <button disabled={busy || !fromImagePath} onClick={() => void importByPath()}>
              使用路径
            </button>
          </div>
          <label className="field">
            <span>角色名</span>
            <input
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder="optional"
            />
          </label>

          <h2>选项</h2>
          <label className="field">
            <span>Provider</span>
            <select
              value={provider}
              onChange={(e) => {
                const v = e.target.value as StudioPrefs["provider"];
                setProvider(v);
                persist({ provider: v });
              }}
            >
              <option value="grok">grok</option>
              <option value="openai">openai</option>
              <option value="codex">codex</option>
            </select>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => {
                setDryRun(e.target.checked);
                persist({ dryRun: e.target.checked });
              }}
            />
            dry-run（无密钥可跑通）
          </label>
          {(["segment", "repair", "occlusion", "expressions", "downstream"] as const).map(
            (k) => (
              <label className="toggle" key={k}>
                <input
                  type="checkbox"
                  checked={Boolean(skip[k])}
                  onChange={(e) =>
                    setSkip((s) => ({ ...s, [k]: e.target.checked }))
                  }
                />
                skip-{k}
              </label>
            )
          )}
          <p className="muted">Compile PSD 为必跑步骤，不可 skip。</p>
          <button disabled={busy} onClick={() => void saveSettings()}>
            Save prefs
          </button>

          <h2>图层</h2>
          {project?.character?.name && (
            <p className="muted">
              {project.character.name}{" "}
              <span className="badge">{project.layers.length} layers</span>
            </p>
          )}
          <div className="layer-list">
            {(project?.layers ?? []).map((l) => (
              <div
                className={`layer ${replaceLayerId === l.id ? "selected" : ""}`}
                key={l.id}
                onClick={() => setReplaceLayerId(l.id)}
                role="button"
                tabIndex={0}
              >
                <div>{l.display_name}</div>
                <div className="meta">
                  {l.semantic} · {l.side} · z={l.z_index}
                  {l.status ? ` · ${l.status}` : ""}
                </div>
                <div className="meta muted">{l.id}</div>
              </div>
            ))}
          </div>

          <h2>Layer replace (NEEDS_REVIEW)</h2>
          <p className="muted">Select a layer, then upload a PNG to replace-and-continue.</p>
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/png"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onReplaceLayerFile(f);
            }}
          />
          <button
            disabled={busy || !replaceLayerId}
            onClick={() => replaceInputRef.current?.click()}
          >
            Upload replace PNG…
          </button>
        </aside>

        <main className="panel center">
          <h2>步骤进度</h2>
          <ul className="checklist">
            {STEP_DEFS.map((s) => (
              <li key={s.id} className={`step ${stepStatus[s.id]}`}>
                <span className="dot" />
                <span className="label">{s.label}</span>
                <span className="status">{stepStatus[s.id]}</span>
              </li>
            ))}
          </ul>

          <h2>State machine</h2>
          <div className="state-panel">
            <p>
              <span className={`badge ${project?.projectState?.state === "NEEDS_REVIEW" ? "fail" : "ok"}`}>
                {project?.projectState?.state ?? "UNKNOWN"}
              </span>{" "}
              <span className="muted">{project?.projectState?.updated_at ?? ""}</span>
            </p>
            <ol className="state-history">
              {(project?.projectState?.history ?? []).slice(-8).map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  → {h.to} <span className="muted">{h.reason}</span>
                </li>
              ))}
            </ol>
          </div>

          {(project?.projectState?.state === "NEEDS_REVIEW" || project?.handoff) && (
            <div className="handoff-panel">
              <h2>Human handoff / NEEDS_REVIEW</h2>
              <p className="muted">{project?.handoff?.reason ?? "Manual review requested"}</p>
              <ul>
                {(project?.handoff?.blocking_findings ?? []).map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
              <p className="muted">Suggested:</p>
              <ul>
                {(project?.handoff?.suggested_actions ?? ["Replace layer PNG", "Re-run repair"]).map(
                  (a) => (
                    <li key={a}>{a}</li>
                  )
                )}
              </ul>
              <div className="row">
                <button disabled={busy} onClick={() => void advanceFromHandoff("REPAIRING")}>
                  Continue → REPAIRING
                </button>
                <button disabled={busy} onClick={() => void advanceFromHandoff("ASSET_GENERATING")}>
                  Back → ASSET_GENERATING
                </button>
              </div>
            </div>
          )}

          <h2>预览</h2>
          <div className="previews">
            {(["master", "recomposed", "segDebug"] as const).map((key) => {
              const url = project?.previewUrls?.[key];
              const labels = {
                master: "master_neutral",
                recomposed: "recomposed_neutral",
                segDebug: "seg_debug",
              };
              return (
                <div className="preview-card" key={key}>
                  {url ? (
                    <img src={`${url}&t=${Date.now()}`} alt={labels[key]} />
                  ) : (
                    <div className="missing">missing</div>
                  )}
                  <div className="label">{labels[key]}</div>
                </div>
              );
            })}
          </div>
        </main>

        <aside className="panel right">
          <h2>Live log</h2>
          <div className="log">
            {log || "Ready. 导入设定图后点击「一键完成全部」。"}
            <div ref={logEndRef} />
          </div>

          <h2>产物 / Artifacts</h2>
          {passed !== null && (
            <p>
              <span className={`badge ${passed ? "ok" : "fail"}`}>
                {passed ? "PASSED" : "FAILED"}
              </span>
            </p>
          )}
          <div className="psd-deliverable">
            <p className="psd-label">PSD 分层文件（可导入 Live2D / Photoshop）</p>
            {psdDownloads.length === 0 ? (
              <p className="muted">Run All 完成后可在此下载 PSD</p>
            ) : (
              <ul className="artifacts psd-list">
                {psdDownloads.map((item) => (
                  <li key={item.path}>
                    <strong>{item.label}</strong>
                    <code>{item.path}</code>
                    <a
                      className="download-psd"
                      href={fileDownloadUrl(item.path)}
                      download
                    >
                      下载 PSD
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ul className="artifacts">
            {artifacts.length === 0 && (
              <li className="muted">
                Run All 完成后显示 PSD / AutoLive2d / psd2live 路径
              </li>
            )}
            {artifacts.map(([k, v]) => (
              <li key={k}>
                <strong>{k}</strong>
                <code>{v}</code>
                {(k === "psd" || k === "psdExport") && v ? (
                  <a
                    className="download-psd"
                    href={fileDownloadUrl(v)}
                    download
                  >
                    下载 PSD
                  </a>
                ) : null}
              </li>
            ))}
          </ul>

          <h2>pipeline_report</h2>
          <div className="report">
            {pipelineSummary ||
              (project?.pipelineReport
                ? JSON.stringify(project.pipelineReport, null, 2)
                : "// 完成后写入 validation/pipeline_report.json")}
          </div>
        </aside>
      </div>
    </div>
  );
}
