/**
 * Board discovery: turn company NAMES into verified board tokens by probing
 * the public endpoints of five ATSs with likely token variants. Only boards
 * that answer with at least one job are added. Runs in the daily Action's
 * network; results merge into companies.seed.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { SeedCompany, SourceName } from "./types.js";

interface Candidate { name: string; tokens?: string[]; workdayTenant?: string }

export function tokenVariants(name: string): string[] {
  const base = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s-]/g, "").trim();
  const squashed = base.replace(/[\s-]+/g, "");
  const hyphened = base.replace(/\s+/g, "-");
  const out = new Set([squashed, hyphened]);
  // "Acme Labs" -> also try "acme"
  const first = base.split(/\s+/)[0];
  if (first && first.length >= 4) out.add(first);
  return [...out];
}

const PROBES: { source: SourceName; url: (t: string) => string; hasJobs: (d: unknown) => boolean }[] = [
  { source: "greenhouse", url: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
    hasJobs: (d) => Array.isArray((d as { jobs?: unknown[] }).jobs) && (d as { jobs: unknown[] }).jobs.length > 0 },
  { source: "lever", url: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    hasJobs: (d) => Array.isArray(d) && (d as unknown[]).length > 0 },
  { source: "ashby", url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
    hasJobs: (d) => Array.isArray((d as { jobs?: unknown[] }).jobs) && (d as { jobs: unknown[] }).jobs.length > 0 },
  { source: "workable", url: (t) => `https://apply.workable.com/api/v1/widget/accounts/${t}`,
    hasJobs: (d) => Array.isArray((d as { jobs?: unknown[] }).jobs) && (d as { jobs: unknown[] }).jobs.length > 0 },
  { source: "recruitee", url: (t) => `https://${t}.recruitee.com/api/offers/`,
    hasJobs: (d) => Array.isArray((d as { offers?: unknown[] }).offers) && (d as { offers: unknown[] }).offers.length > 0 },
];

/**
 * Workday needs two unknowns - the tenant host (wd1/wd3/wd5/wd12) and the
 * site name - so it cannot be probed with a single URL like the others.
 * These are the site names large employers actually use, in rough order of
 * how often they appear.
 */
const WD_HOSTS = ["wd1", "wd3", "wd5", "wd12", "wd2"];
const WD_SITES = [
  "External", "Careers", "External_Career_Site", "ExternalCareerSite",
  "careers", "External_Careers", "Search",
];

async function probeWorkday(tenant: string): Promise<{ host: string; site: string } | null> {
  for (const h of WD_HOSTS) {
    const host = `${tenant}.${h}.myworkdayjobs.com`;
    for (const site of WD_SITES) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, {
          method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" }),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { jobPostings?: unknown[]; total?: number };
        if ((data.jobPostings?.length ?? 0) > 0) return { host, site };
      } catch {
        // silent-ok: probing candidates - a wrong host or site is the
        // expected outcome for most guesses, not an error to report.
      } finally {
        clearTimeout(t);
      }
    }
  }
  return null;
}

async function probeOne(source: SourceName, url: string, hasJobs: (d: unknown) => boolean): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return false;
    return hasJobs(await res.json());
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** How many candidate names one run probes. The sponsor firehose put 1,500+
 *  names in the queue; probing all of them every day is ~25k requests re-asking
 *  questions already answered. A budget per run drains the backlog in a few
 *  days, and the attempted-file keeps a name quiet for RETRY_DAYS after its
 *  probe -- companies do adopt an ATS later, so misses retry, just slowly. */
const NAMES_PER_RUN = 400;
const RETRY_DAYS = 45;

export async function discover(namesPath: string, seedPath: string): Promise<void> {
  const allCandidates: Candidate[] = JSON.parse(readFileSync(namesPath, "utf8"));
  const seeds: SeedCompany[] = JSON.parse(readFileSync(seedPath, "utf8"));
  const have = new Set(seeds.map((s) => `${s.source}|${s.token}`));

  const attemptedPath = namesPath.replace(/[^\/]+$/, "discovery.attempted.json");
  let attempted: Record<string, string> = {};
  try { attempted = JSON.parse(readFileSync(attemptedPath, "utf8")); } catch { /* first run */ }
  const cutoff = Date.now() - RETRY_DAYS * 24 * 60 * 60 * 1000;
  const due = (c: Candidate) => {
    const last = attempted[c.name.toLowerCase()];
    return !last || new Date(last).getTime() < cutoff;
  };
  const candidates = allCandidates.filter(due).slice(0, NAMES_PER_RUN);
  console.log(`discover: ${candidates.length} of ${allCandidates.length} names due this run`);

  const tasks: { name: string; source: SourceName; token: string; url: string; hasJobs: (d: unknown) => boolean }[] = [];
  const claimed = new Set<string>(); // one board per (name, source): first variant wins
  for (const c of candidates) {
    const variants = c.tokens ?? tokenVariants(c.name);
    for (const probe of PROBES) {
      for (const token of variants) {
        tasks.push({ name: c.name, source: probe.source, token, url: probe.url(token), hasJobs: probe.hasJobs });
      }
    }
  }

  const found: SeedCompany[] = [];

  // Workday candidates carry an explicit tenant to probe.
  const wdCandidates = candidates.filter((c) => (c as { workdayTenant?: string }).workdayTenant);
  for (const c of wdCandidates) {
    const tenant = (c as { workdayTenant?: string }).workdayTenant!;
    if (have.has(`workday|${tenant}`)) continue;
    const hit = await probeWorkday(tenant);
    if (hit) {
      have.add(`workday|${tenant}`);
      found.push({
        name: c.name, source: "workday", token: tenant, verified: true,
        params: { host: hit.host, site: hit.site },
        note: `discovered ${new Date().toISOString().slice(0, 10)}`,
      });
      console.log(`  FOUND workday      ${tenant.padEnd(28)} (${c.name}) site=${hit.site}`);
    }
  }
  let done = 0;
  const CONCURRENCY = 8;
  async function worker() {
    for (;;) {
      const task = tasks.shift();
      if (!task) return;
      done++;
      const claimKey = `${task.name}|${task.source}`;
      const seedKey = `${task.source}|${task.token}`;
      if (claimed.has(claimKey) || have.has(seedKey)) continue;
      if (await probeOne(task.source, task.url, task.hasJobs)) {
        claimed.add(claimKey);
        have.add(seedKey);
        found.push({ name: task.name, source: task.source, token: task.token, verified: true,
          note: `discovered ${new Date().toISOString().slice(0, 10)}` });
        console.log(`  FOUND ${task.source.padEnd(12)} ${task.token.padEnd(28)} (${task.name})`);
      }
      if (done % 100 === 0) console.log(`  ...${done} probes done, ${found.length} found`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (found.length > 0) {
    // A company found on multiple ATSs keeps only its busiest-looking source?
    // Keep all - fetch dedups nothing across sources, but duplicate companies
    // across ATSs are rare and harmless (slot keys differ by source).
    writeFileSync(seedPath, JSON.stringify([...seeds, ...found], null, 2));
  }

  const probedIso = new Date().toISOString();
  for (const c of candidates) attempted[c.name.toLowerCase()] = probedIso;
  writeFileSync(attemptedPath, JSON.stringify(attempted, null, 1));
  console.log(`\ndiscover: ${done} probes, ${found.length} new boards -> ${seedPath}`);
}
