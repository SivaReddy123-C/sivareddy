import { getJson } from "../http.js";
import { htmlToText, toIso } from "../normalize.js";
import type { Job, SeedCompany, SourceAdapter } from "../types.js";

// Public widget API: https://apply.workable.com/api/v1/widget/accounts/{account}?details=true
interface WorkableJob {
  title: string;
  shortcode: string;
  url?: string;
  application_url?: string;
  published_on?: string;
  department?: string;
  employment_type?: string;
  description?: string;
  location?: { city?: string; region?: string; country?: string; telecommuting?: boolean };
}

export const workable: SourceAdapter = {
  source: "workable",
  async fetchJobs(company: SeedCompany): Promise<Job[]> {
    const url = `https://apply.workable.com/api/v1/widget/accounts/${company.token}?details=true`;
    const data = await getJson<{ jobs: WorkableJob[] }>(url);
    return (data.jobs ?? []).map((j) => {
      const loc = [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", ");
      const description = htmlToText(j.description);
      return {
        key: `workable:${company.token}:${j.shortcode}`,
        source: "workable" as const,
        company: company.name,
        companyToken: company.token,
        sourceJobId: j.shortcode,
        title: j.title,
        location: loc,
        remote: j.location?.telecommuting ?? null,
        url: j.url ?? `https://apply.workable.com/${company.token}/j/${j.shortcode}/`,
        applyUrl: j.application_url ?? null,
        department: j.department ?? null,
        employmentType: j.employment_type ?? null,
        description,
        hasSalaryInfo: /(salary|compensation|pay range)\s*[:\-]?\s*(₹|\$|€|£|[0-9])/i.test(description ?? ""),
        publishedAt: toIso(j.published_on),
        updatedAt: null,
      };
    });
  },
};
