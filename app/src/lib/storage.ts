import type { AppState, ResumeData, ResumeSettings, SectionKey } from "./types.js";

const KEY = "jobradar.v1";

export const ALL_SECTIONS: SectionKey[] = ["summary", "experience", "projects", "education", "skills"];

export function defaultSettings(): ResumeSettings {
  return { accent: "#1f6feb", font: "template", density: "comfortable", sectionOrder: [...ALL_SECTIONS] };
}

export function emptyResume(): ResumeData {
  return {
    basics: { name: "", headline: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    education: [],
    experience: [],
    projects: [],
    skills: [],
    template: "classic",
    settings: defaultSettings(),
  };
}

/** Keep known sections in the user's order, drop unknowns, append anything missing. */
export function normalizeSectionOrder(order: unknown): SectionKey[] {
  const given = Array.isArray(order) ? order.filter((k): k is SectionKey => (ALL_SECTIONS as string[]).includes(k)) : [];
  const missing = ALL_SECTIONS.filter((k) => !given.includes(k));
  return [...given, ...missing];
}

export function emptyState(): AppState {
  return { version: 1, resume: emptyResume(), applications: [] };
}

/** Merge a parsed object over the empty state so missing fields never crash the UI. */
export function normalizeState(raw: unknown): AppState {
  const base = emptyState();
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Partial<AppState>;
  const settings = { ...defaultSettings(), ...(r.resume?.settings ?? {}) };
  settings.sectionOrder = normalizeSectionOrder(settings.sectionOrder);
  return {
    version: 1,
    resume: {
      ...base.resume,
      ...(r.resume ?? {}),
      basics: { ...base.resume.basics, ...(r.resume?.basics ?? {}) },
      settings,
    },
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
