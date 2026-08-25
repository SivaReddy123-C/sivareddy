import { getJson } from "../http.js";
import { htmlToText, toIso } from "../normalize.js";
import type { Job, SeedCompany, SourceAdapter } from "../types.js";

// Docs: https://developers.ashbyhq.com/docs/public-job-posting-api (public, no auth)
interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location: string }[];
  department?: string;
  team?: string;
  employmentType?: string;
  isRemote?: boolean;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  compensation?: { compensationTierSummary?: string } | null;
}

export const ashby: SourceAdapter = {
  source: "ashby",
  async fetchJobs(company: SeedCompany): Promise<Job[]> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${company.token}?includeCompensation=true`;
    const data = await getJson<{ jobs: AshbyJob[] }>(url);
    return (data.jobs ?? []).map((j) => ({
      key: `ashby:${company.token}:${j.id}`,
      source: "ashby" as const,
      company: company.name,
      companyToken: company.token,
      sourceJobId: j.id,
      title: j.title,
      location: [j.location, ...(j.secondaryLocations?.map((s) => s.location) ?? [])]
        .filter(Boolean)
        .join("; "),
      remote: j.isRemote ?? null,
      url: j.jobUrl ?? `https://jobs.ashbyhq.com/${company.token}/${j.id}`,
      applyUrl: j.applyUrl ?? null,
      department: j.department ?? j.team ?? null,
      employmentType: j.employmentType ?? null,
      description: htmlToText(j.descriptionHtml),
      hasSalaryInfo: Boolean(j.compensation?.compensationTierSummary),
      publishedAt: toIso(j.publishedAt),
      updatedAt: null,
    }));
  },
};
