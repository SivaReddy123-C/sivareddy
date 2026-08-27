import type { AnswerEntry, AppState, ResumeData, ResumeSettings, SectionKey } from "./types.js";

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

export function defaultAnswers(): AnswerEntry[] {
  return [
    { id: "work_auth", label: "Are you authorized to work in this country?", value: "" },
    { id: "sponsorship", label: "Will you now or in the future require visa sponsorship?", value: "" },
    { id: "notice", label: "Notice period / earliest start date", value: "" },
    { id: "salary", label: "Salary expectation", value: "" },
    { id: "experience", label: "Years of relevant experience", value: "" },
    { id: "relocate", label: "Willing to relocate?", value: "" },
  ];
}

export function emptyState(): AppState {
  return { version: 1, resume: emptyResume(), applications: [], answers: defaultAnswers() };
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
    answers: Array.isArray(r.answers) && r.answers.length > 0 ? r.answers : defaultAnswers(),
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

/**
 * Why a save last failed, or "" when the last save succeeded.
 *
 * This used to be swallowed with a comment saying the session still works in
 * memory. It does - until the tab closes, and then the resume someone spent an
 * hour on is gone with no warning that it was never saved. Storage genuinely
 * does fill up: a 24MB feed cache was competing for the same quota.
 */
export let lastStorageError = "";

/** Listeners notified when a save fails, so the UI can say so. */
const saveFailureListeners = new Set<(message: string) => void>();

export function onSaveFailure(fn: (message: string) => void): () => void {
  saveFailureListeners.add(fn);
  return () => saveFailureListeners.delete(fn);
}

export function saveState(state: AppState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    lastStorageError = "";
    return true;
  } catch (err) {
    const quota = (err as Error)?.name === "QuotaExceededError";
    lastStorageError = quota
      ? "Your browser's storage is full, so this change was NOT saved. Export your data "
        + "(Download .json) before closing this tab."
      : `This change was NOT saved: ${(err as Error).message}`;
    for (const fn of saveFailureListeners) fn(lastStorageError);
    return false;
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
