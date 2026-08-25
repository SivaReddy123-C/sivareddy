/** A job posting normalized across all ATS sources. */
export interface Job {
  /** Stable key: `${source}:${companyToken}:${sourceJobId}` */
  key: string;
  source: SourceName;
  /** Company display name from the seed list. */
  company: string;
  /** Board/company token used against the source API. */
  companyToken: string;
  sourceJobId: string;
  title: string;
  location: string;
  remote: boolean | null;
  url: string;
  applyUrl: string | null;
  department: string | null;
  employmentType: string | null;
  /** Plain-text description, truncated. Null when the source list endpoint omits it. */
  description: string | null;
  hasSalaryInfo: boolean;
  /** ISO date the source claims the job was published/created, if exposed. */
  publishedAt: string | null;
  /** ISO date the source claims the job was last updated, if exposed. */
  updatedAt: string | null;
}

export type SourceName = "greenhouse" | "lever" | "ashby" | "smartrecruiters";

export interface SeedCompany {
  name: string;
  source: SourceName;
  token: string;
  /** false until someone has run `probe` and confirmed the board answers. */
  verified: boolean;
  note?: string;
}

export interface SourceAdapter {
  source: SourceName;
  /** Fetch and normalize all open postings for one company board. */
  fetchJobs(company: SeedCompany): Promise<Job[]>;
}

/** Longitudinal state persisted between runs - what makes ghost detection possible. */
export interface JobHistory {
  firstSeenAt: string;
  lastSeenAt: string;
  /** Distinct source job ids observed for the same (company, title, location) slot. */
  seenIds: string[];
}

export interface GhostSignal {
  id: string;
  weight: number;
  reason: string;
}

export interface GhostAssessment {
  /** 0-100. Higher = more likely this posting will never hire anyone. */
  score: number;
  band: "low" | "medium" | "high" | "critical";
  signals: GhostSignal[];
}

export interface ScoredJob extends Job {
  firstSeenAt: string;
  lastSeenAt: string;
  ghost: GhostAssessment;
}
