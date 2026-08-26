import { toIso } from "../normalize.js";
import type { Job, SeedCompany, SourceAdapter } from "../types.js";

/**
 * Workday CXS jobs endpoint - the public JSON API behind every
 * *.myworkdayjobs.com careers page. Read-only, paginated POST, no auth.
 * Seed entries need params: { host: "nvidia.wd5.myworkdayjobs.com", site: "NVIDIAExternalCareerSite" }.
 * Descriptions require a per-job call, so list-level fields only (description
 * stays null and thin_description scoring is skipped by design).
 */
interface WdPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string; // "Posted 3 Days Ago", "Posted 30+ Days Ago"
  bulletFields?: string[];
}

const PAGE = 20;
const MAX_JOBS = 2000; // per-board cap; giants list thousands and we want them

function postedOnToIso(text: string | undefined, now: Date): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/today|just posted/.test(t)) return now.toISOString();
  if (/yesterday/.test(t)) return new Date(now.getTime() - 86400000).toISOString();
  const m = /(\d+)\+?\s*days?/.exec(t);
  if (m) return new Date(now.getTime() - Number(m[1]) * 86400000).toISOString();
  return null;
}

export const workday: SourceAdapter = {
  source: "workday",
  async fetchJobs(company: SeedCompany): Promise<Job[]> {
    const host = company.params?.host;
    const site = company.params?.site;
    if (!host || !site) throw new Error(`workday seed ${company.token} missing params.host/site`);
    const tenant = host.split(".")[0];
    const endpoint = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
    const now = new Date();
    const jobs: Job[] = [];
    // Workday only reports `total` reliably on the FIRST page - later pages
    // often return 0/absent. Capture it once; absent means "unknown, keep
    // paging until a short page or the cap".
    let knownTotal = Number.POSITIVE_INFINITY;

    for (let offset = 0; offset < MAX_JOBS; offset += PAGE) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: PAGE, offset, searchText: "" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
      const data = (await res.json()) as { jobPostings?: WdPosting[]; total?: number };
      if (offset === 0 && typeof data.total === "number" && data.total > 0) knownTotal = data.total;
      const page = data.jobPostings ?? [];
      for (const p of page) {
        // bulletFields[0] is the requisition id, which Workday repeats across
        // locations; the path is what actually identifies one posting.
        const id = p.externalPath || p.bulletFields?.[0] || p.title;
        jobs.push({
          key: `workday:${company.token}:${id}`,
          source: "workday",
          company: company.name,
          companyToken: company.token,
          sourceJobId: id,
          title: p.title,
          location: p.locationsText ?? "",
          remote: null,
          url: `https://${host}${p.externalPath}`,
          applyUrl: null,
          department: null,
          employmentType: null,
          description: null,
          hasSalaryInfo: false,
          publishedAt: postedOnToIso(p.postedOn, now),
          updatedAt: null,
        });
      }
      if (page.length < PAGE || jobs.length >= knownTotal) break;
      await new Promise((r) => setTimeout(r, 120)); // be polite, but 100 pages must still finish
    }
    return jobs;
  },
};
