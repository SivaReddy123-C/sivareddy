import { getJson } from "../http.js";
import { toIso } from "../normalize.js";
import type { Job, SeedCompany, SourceAdapter } from "../types.js";

// Docs: https://developers.smartrecruiters.com/docs/posting-api (public, no auth)
interface SrPosting {
  id: string;
  uuid?: string;
  name: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
  department?: { label?: string };
  typeOfEmployment?: { label?: string };
}

export const smartrecruiters: SourceAdapter = {
  source: "smartrecruiters",
  async fetchJobs(company: SeedCompany): Promise<Job[]> {
    const jobs: Job[] = [];
    let offset = 0;
    const limit = 100;
    for (;;) {
      const url = `https://api.smartrecruiters.com/v1/companies/${company.token}/postings?limit=${limit}&offset=${offset}`;
      const data = await getJson<{ content: SrPosting[]; totalFound: number }>(url);
      for (const p of data.content ?? []) {
        const loc = [p.location?.city, p.location?.region, p.location?.country]
          .filter(Boolean)
          .join(", ");
        jobs.push({
          key: `smartrecruiters:${company.token}:${p.id}`,
          source: "smartrecruiters",
          company: company.name,
          companyToken: company.token,
          sourceJobId: p.id,
          title: p.name,
          location: loc,
          remote: p.location?.remote ?? null,
          url: `https://jobs.smartrecruiters.com/${company.token}/${p.id}`,
          applyUrl: `https://jobs.smartrecruiters.com/${company.token}/${p.id}`,
          department: p.department?.label ?? null,
          employmentType: p.typeOfEmployment?.label ?? null,
          // List endpoint has no description; fetching each posting would be N+1 calls.
          description: null,
          hasSalaryInfo: false,
          publishedAt: toIso(p.releasedDate),
          updatedAt: null,
        });
      }
      offset += limit;
      if (offset >= (data.totalFound ?? 0) || (data.content ?? []).length === 0) break;
    }
    return jobs;
  },
};
