import { useCallback, useEffect, useState } from "react";
import { loadPrefs, savePrefs, type StudioPrefs } from "./storage";

type Layer = {
  id: string;
  display_name: string;
  semantic: string;
  side: string;
  z_index: number;
  status?: string;
};

type ProjectPayload = {
  projectPath: string;
  layers: Layer[];
  character?: { name?: string; id?: string };
  validation?: unknown;
  segmentation?: unknown;
  settings?: { provider?: string; dryRun?: boolean };
  previewExists: Record<string, boolean>;
  previewUrls: Record<string, string | null>;
};

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
  const [feather, setFeather] = useState(2);
  const [splitBilateral, setSplitBilateral] = useState(true);

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

  const saveSettings = async () => {
    persist();
    await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath, provider, dryRun }),
    });
    setLog((p) => p + `Saved settings → .ai2live-studio.json + localStorage\n`);
  };

  const run = async (action: string) => {
    setBusy(true);
    setError(null);
    try {
      await saveSettings();
      const result = await api<{
        code: number;
        stdout: string;
        stderr: string;
        validation?: unknown;
      }>("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          projectPath,
          provider,
          dryRun,
          extra: { feather, splitBilateral, debug: true },
        }),
      });
      setLog(
        (p) =>
          p +
          `\n$ ai2live ${action}\n` +
          result.stdout +
          (result.stderr ? `\n[stderr]\n${result.stderr}` : "") +
          `\n(exit ${result.code})\n`
      );
      await openProject(projectPath);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const validationJson = project?.validation
    ? JSON.stringify(project.validation, null, 2)
    : project?.segmentation
      ? JSON.stringify(project.segmentation, null, 2)
      : "// Run validate or segment to populate reports";

  const passed =
    project?.validation &&
    typeof project.validation === "object" &&
    project.validation !== null &&
    "passed" in project.validation
      ? Boolean((project.validation as { passed?: boolean }).passed)
      : null;

  return (
    <div className="app">
      <header>
        <h1>ai2live Studio</h1>
        <input
          className="path"
          value={projectPath}
          onChange={(e) => setProjectPath(e.target.value)}
          placeholder="Project path"
        />
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
        <label className="toggle">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => {
              setDryRun(e.target.checked);
              persist({ dryRun: e.target.checked });
            }}
          />
          dry-run
        </label>
        <button disabled={busy} onClick={() => void saveSettings()}>
          Save prefs
        </button>
      </header>

      {error && (
        <div style={{ padding: "0.5rem 1rem", color: "var(--err)" }}>{error}</div>
      )}

      <div className="layout">
        <aside className="panel">
          <h2>Layers</h2>
          {project?.character?.name && (
            <p className="muted">
              {project.character.name}{" "}
              <span className="badge">{project.layers.length} layers</span>
            </p>
          )}
          {(project?.layers ?? []).map((l) => (
            <div className="layer" key={l.id}>
              <div>{l.display_name}</div>
              <div className="meta">
                {l.semantic} · {l.side} · z={l.z_index} {l.status ?? ""}
              </div>
            </div>
          ))}
          {!project && <p className="muted">Open a project to list layers.</p>}
        </aside>

        <main className="panel" style={{ background: "var(--bg)" }}>
          <h2>Preview</h2>
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
                    <div
                      style={{
                        aspectRatio: "1",
                        display: "grid",
                        placeItems: "center",
                        color: "var(--muted)",
                        fontSize: "0.8rem",
                      }}
                    >
                      missing
                    </div>
                  )}
                  <div className="label">{labels[key]}</div>
                </div>
              );
            })}
          </div>

          <h2 style={{ marginTop: "1.25rem" }}>Actions</h2>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => run("compile")}>
              Compile
            </button>
            <button disabled={busy} onClick={() => run("validate")}>
              Validate
            </button>
            <button disabled={busy} onClick={() => run("segment")}>
              Segment
            </button>
            <button disabled={busy} onClick={() => run("doctor")}>
              Doctor
            </button>
          </div>
          <div className="row">
            <label className="toggle">
              feather
              <input
                type="number"
                min={0}
                max={16}
                value={feather}
                onChange={(e) => setFeather(Number(e.target.value))}
                style={{ width: 64 }}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={splitBilateral}
                onChange={(e) => setSplitBilateral(e.target.checked)}
              />
              split-bilateral
            </label>
          </div>
          <h2>Log</h2>
          <div className="log">{log || "Ready."}</div>
        </main>

        <aside className="panel">
          <h2>Validation report</h2>
          {passed !== null && (
            <p>
              <span className={`badge ${passed ? "ok" : "fail"}`}>
                {passed ? "PASSED" : "FAILED"}
              </span>
            </p>
          )}
          <div className="report">{validationJson}</div>
        </aside>
      </div>
    </div>
  );
}
