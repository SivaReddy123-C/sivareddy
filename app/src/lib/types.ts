/** Everything lives in the user's browser. No accounts, no server, no custody. */

export interface ResumeLink {
  label: string;
  url: string;
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  start: string;
  end: string;
  score: string; // GPA / percentage - free text
  details: string;
}

export interface ExperienceEntry {
  id: string;
  company: string;
  role: string;
  location: string;
  start: string;
  end: string;
  bullets: string[];
}

export interface ProjectEntry {
  id: string;
  name: string;
  link: string;
  bullets: string[];
}

export interface SkillGroup {
  id: string;
  group: string; // "Languages", "Frameworks", ...
  items: string; // comma-separated, kept as typed
}

export type TemplateId = "classic" | "compact" | "modern" | "elegant" | "mono" | "minimal";

export type FontChoice = "template" | "serif" | "sans" | "mono";
export type Density = "comfortable" | "compact";
export type SectionKey = "summary" | "experience" | "projects" | "education" | "skills";

export interface ResumeSettings {
  accent: string;      // hex color used by templates that show an accent
  font: FontChoice;    // "template" = let the template decide
  density: Density;
  sectionOrder: SectionKey[];
}

export interface ResumeData {
  basics: {
    name: string;
    headline: string;
    email: string;
    phone: string;
    location: string;
    links: ResumeLink[];
  };
  summary: string;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  skills: SkillGroup[];
  template: TemplateId;
  settings: ResumeSettings;
}

export type AppStatus =
  | "applied"
  | "replied"
  | "interview"
  | "offer"
  | "accepted"
  | "rejected"
  | "withdrawn";

export interface Application {
  id: string;
  company: string;
  title: string;
  url: string;
  location: string;
  source: string; // "company site", "referral", "jobradar", ...
  appliedAt: string; // ISO date
  status: AppStatus;
  statusChangedAt: string; // ISO date of last status change
  notes: string;
}

export interface AppState {
  version: 1;
  resume: ResumeData;
  applications: Application[];
}
