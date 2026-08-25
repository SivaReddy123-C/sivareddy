import { getJson } from "../http.js";
import { htmlToText, toIso } from "../normalize.js";
import type { Job, SeedCompany, SourceAdapter } from "../types.js";

// Docs: https://github.com/lever/postings-api (public, no auth)
interface LeverPosting {
  id: string;
  text: string;
  createdAt?: number;
  hostedUrl: string;
  applyUrl?: string;
  categories?: { location?: string; team?: string; department?: string; commitment?: string };
  workplaceType?: string;
  descriptionPlain?: string;
  description?: string;
  salaryRange?: { min?: number; max?: number; currency?: string };
  country?: string;
}

export const lever: SourceAdapter = {
  source: "lever",
  async fetchJobs(company: SeedCompany): Promise<Job[]> {
    const url = `https://api.lever.co/v0/postings/${company.token}?mode=json`;
    const data = await getJson<LeverPosting[]>(url);
    return (data ?? []).map((p) => ({
      key: `lever:${company.token}:${p.id}`,
      source: "lever" as const,
      company: company.name,
      companyToken: company.token,
      sourceJobId: p.id,
      title: p.text,
      location: p.categories?.location ?? "",
      remote: p.workplaceType ? p.workplaceType.toLowerCase() === "remote" : null,
      url: p.hostedUrl,
      applyUrl: p.applyUrl ?? p.hostedUrl,
      department: p.categories?.team ?? p.categories?.department ?? null,
      employmentType: p.categories?.commitment ?? null,
      description: p.descriptionPlain?.slice(0, 3000) ?? htmlToText(p.description),
      hasSalaryInfo: Boolean(p.salaryRange && (p.salaryRange.min || p.salaryRange.max)),
      publishedAt: toIso(p.createdAt ?? null),
      updatedAt: null,
    }));
  },
};
