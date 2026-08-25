import { getJson } from "../http.js";
import { htmlToText, toIso } from "../normalize.js";
import type { Job, SeedCompany, SourceAdapter } from "../types.js";

// Docs: https://developers.greenhouse.io/job-board.html (public, no auth)
interface GhJob {
  id: number;
  title: string;
  updated_at: string;
  first_published?: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  departments?: { name: string }[];
  metadata?: unknown;
}

export const greenhouse: SourceAdapter = {
  source: "greenhouse",
  async fetchJobs(company: SeedCompany): Promise<Job[]> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${company.token}/jobs?content=true`;
    const data = await getJson<{ jobs: GhJob[] }>(url);
    return (data.jobs ?? []).map((j) => {
      const description = htmlToText(j.content);
      return {
        key: `greenhouse:${company.token}:${j.id}`,
        source: "greenhouse",
        company: company.name,
        companyToken: company.token,
        sourceJobId: String(j.id),
        title: j.title,
        location: j.location?.name ?? "",
        remote: j.location?.name?.toLowerCase().includes("remote") ?? null,
        url: j.absolute_url,
        applyUrl: j.absolute_url,
        department: j.departments?.[0]?.name ?? null,
        employmentType: null,
        description,
        hasSalaryInfo: hasSalaryText(description),
        publishedAt: toIso(j.first_published),
        updatedAt: toIso(j.updated_at),
      };
    });
  },
};

/** Greenhouse has no structured salary field on the board API; detect it in the text. */
export function hasSalaryText(text: string | null): boolean {
  if (!text) return false;
  return /(salary|compensation|pay range|ctc|per annum|lpa)\s*[:\-]?\s*(₹|\$|€|£|inr|usd|eur|[0-9])/i.test(text) ||
    /(₹|\$|€|£)\s?[\d,.]+\s?(k|lakh|lpa|million|-|to|–)/i.test(text);
}
