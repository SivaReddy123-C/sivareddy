import type { AppState, ResumeData } from "./types.js";

const KEY = "jobradar.v1";

export function emptyResume(): ResumeData {
  return {
    basics: { name: "", headline: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    education: [],
    experience: [],
    projects: [],
    skills: [],
    template: "classic",
  };
}

export function emptyState(): AppState {
  return { version: 1, resume: emptyResume(), applications: [] };
}

/** Merge a parsed object over the empty state so missing fields never crash the UI. */
export function normalizeState(raw: unknown): AppState {
  const base = emptyState();
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Partial<AppState>;
  return {
    version: 1,
    resume: { ...base.resume, ...(r.resume ?? {}), basics: { ...base.resume.basics, ...(r.resume?.basics ?? {}) } },
    applications: Array.isArray(r.applications) ? r.applications : [],
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeState(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked (private mode) - the session still works in memory.
  }
}

/** Everything the user has, as a downloadable file. Their data, their file. */
export function exportJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(text: string): AppState {
  return normalizeState(JSON.parse(text));
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
