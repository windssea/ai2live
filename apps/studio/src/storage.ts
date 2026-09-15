export type StudioPrefs = {
  projectPath: string;
  provider: "grok" | "openai" | "codex";
  dryRun: boolean;
};

const KEY = "ai2live.studio.prefs";

export function loadPrefs(): Partial<StudioPrefs> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<StudioPrefs>;
  } catch {
    return {};
  }
}

export function savePrefs(prefs: StudioPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
