import { getJson } from "../http.js";
import { htmlToText, toIso } from "../normalize.js";
import type { Job, SeedCompany, SourceAdapter } from "../types.js";

// Public careers API: https://{company}.recruitee.com/api/offers/
interface RecruiteeOffer {
  id: number;
  title: string;
  description?: string;
  careers_url?: string;
  created_at?: string;
  department?: string;
  employment_type_code?: string;
  city?: string;
  country?: string;
  remote?: boolean;
}

export const recruitee: SourceAdapter = {
  source: "recruitee",
  async fetchJobs(company: SeedCompany): Promise<Job[]> {
    const url = `https://${company.token}.recruitee.com/api/offers/`;
    const data = await getJson<{ offers: RecruiteeOffer[] }>(url);
    return (data.offers ?? []).map((o) => {
      const description = htmlToText(o.description);
      return {
        key: `recruitee:${company.token}:${o.id}`,
        source: "recruitee" as const,
        company: company.name,
        companyToken: company.token,
        sourceJobId: String(o.id),
        title: o.title,
        location: [o.city, o.country].filter(Boolean).join(", "),
        remote: o.remote ?? null,
        url: o.careers_url ?? `https://${company.token}.recruitee.com/o/${o.id}`,
        applyUrl: o.careers_url ?? null,
        department: o.department ?? null,
        employmentType: o.employment_type_code ?? null,
        description,
        hasSalaryInfo: /(salary|compensation|pay range)\s*[:\-]?\s*(₹|\$|€|£|[0-9])/i.test(description ?? ""),
        publishedAt: toIso(o.created_at),
        updatedAt: null,
      };
    });
  },
};
