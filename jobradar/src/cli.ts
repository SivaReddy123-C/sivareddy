import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StubClassifier } from "./classify.js";
import { assessGhost } from "./ghost.js";
import { detectCountry, matchesCountry, slotKey, sponsorshipSignal, type Country } from "./normalize.js";
import { extractTags } from "./skills.js";
import { greenhouse } from "./sources/greenhouse.js";
import { lever } from "./sources/lever.js";
import { ashby } from "./sources/ashby.js";
import { smartrecruiters } from "./sources/smartrecruiters.js";
import { workable } from "./sources/workable.js";
import { recruitee } from "./sources/recruitee.js";
import { workday } from "./sources/workday.js";
import { Store } from "./store.js";
import type { Job, ScoredJob, SeedCompany, SourceAdapter } from "./types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const adapters: Record<string, SourceAdapter> = { greenhouse, lever, ashby, smartrecruiters, workable, recruitee, workday };

function loadSeeds(): SeedCompany[] {
  return JSON.parse(readFileSync(join(DATA, "companies.seed.json"), "utf8"));
}

/** `probe`: check every seed board actually answers, so the seed list stays honest. */
async function probe(): Promise<void> {
  const seeds = loadSeeds();
  let ok = 0;
  for (const c of seeds) {
    const adapter = adapters[c.source]!;
    try {
      const jobs = await adapter.fetchJobs(c);
      ok++;
      console.log(`  OK    ${c.source.padEnd(15)} ${c.token.padEnd(30)} ${jobs.length} open jobs`);
    } catch (err) {
      console.log(`  FAIL  ${c.source.padEnd(15)} ${c.token.padEnd(30)} ${(err as Error).message}`);
    }
  }
  console.log(`\n${ok}/${seeds.length} boards reachable. Fix or remove FAILed tokens in data/companies.seed.json (set "verified": true on the ones that answered).`);
}

async function fetchAll(): Promise<void> {
  const seeds = loadSeeds();
  const store = new Store(DATA);
  const classifier = new StubClassifier();

  // Boards were fetched one at a time, which became the whole runtime once
  // deep Workday boards joined the seed (300+ boards, some paginating to
  // 2,000 postings). They are independent hosts, so fetch a few at once -
  // wall time drops to roughly the slowest board rather than their sum.
  const CONCURRENCY = 6;
  const queue = [...seeds];
  const results: { company: SeedCompany; employerType: string; jobs: Job[] }[] = [];

  async function worker(): Promise<void> {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      const employerType = c.employerType ?? classifier.classifyEmployer(c.name).type;
      const adapter = adapters[c.source];
      if (!adapter) {
        console.error(`ERROR ${c.name}: no adapter for source ${c.source}`);
        continue;
      }
      try {
        const jobs = await adapter.fetchJobs(c);
        results.push({ company: c, employerType, jobs });
        console.log(`fetched ${String(jobs.length).padStart(5)} jobs  ${c.name} (${c.source})`);
      } catch (err) {
        console.error(`ERROR ${c.name} (${c.source}/${c.token}): ${(err as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Scoring stays sequential and after the fetch: it touches the shared
  // longitudinal store, and keeping it single-threaded keeps that honest.
  const all: ScoredJob[] = [];
  for (const { company, employerType, jobs } of results) {
    store.record(jobs);
    const concurrent = new Map<string, number>();
    for (const job of jobs) {
      const k = slotKey(job.source, job.companyToken, job.title, job.location);
      concurrent.set(k, (concurrent.get(k) ?? 0) + 1);
    }
    for (const job of jobs) {
      const history = store.historyFor(job);
      const open = concurrent.get(slotKey(job.source, job.companyToken, job.title, job.location)) ?? 1;
      all.push({
        ...job,
        firstSeenAt: history?.firstSeenAt ?? new Date().toISOString(),
        lastSeenAt: history?.lastSeenAt ?? new Date().toISOString(),
        ghost: assessGhost(job, history, new Date(), open, employerType),
        sponsorship: sponsorshipSignal(job.description),
      });
    }
    void company;
  }

  store.writeLatest({ fetchedAt: new Date().toISOString(), jobs: all });
  console.log(`\nTotal: ${all.length} jobs from ${results.length}/${seeds.length} boards -> data/latest.json`);
}

function report(country: Country | null): void {
  const store = new Store(DATA);
  const latest = store.readLatest<{ fetchedAt: string; jobs: ScoredJob[] }>();
  if (!latest) {
    console.error("No data yet - run `npm run fetch` first.");
    process.exit(1);
  }
  let jobs = latest.jobs;
  if (country) jobs = jobs.filter((j) => matchesCountry(j.location, country));

  const label = country === "in" ? " (India)" : country === "us" ? " (USA)" : "";
  console.log(`Snapshot from ${latest.fetchedAt} - ${jobs.length} jobs${label}\n`);

  const byBand = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const j of jobs) byBand[j.ghost.band]++;
  console.log("Ghost-risk distribution:");
  for (const [band, n] of Object.entries(byBand)) {
    const pct = jobs.length ? ((n / jobs.length) * 100).toFixed(1) : "0.0";
    console.log(`  ${band.padEnd(9)} ${String(n).padStart(5)}  (${pct}%)`);
  }

  const sponsor = { yes: 0, no: 0, unknown: 0 };
  for (const j of jobs) sponsor[j.sponsorship ?? "unknown"]++;
  console.log(`\nVisa sponsorship (from description text): ${sponsor.yes} state they sponsor, ${sponsor.no} state they do NOT, ${sponsor.unknown} don't say`);

  const risky = jobs
    .filter((j) => j.ghost.band === "high" || j.ghost.band === "critical")
    .sort((a, b) => b.ghost.score - a.ghost.score)
    .slice(0, 15);
  if (risky.length) {
    console.log("\nHighest ghost risk:");
    for (const j of risky) {
      console.log(`  [${j.ghost.score}] ${j.company} - ${j.title} (${j.location || "no location"})`);
      for (const s of j.ghost.signals) console.log(`        - ${s.reason}`);
    }
  }
}

/** `sync`: push the latest run into Supabase (idempotent per day). */
async function sync(): Promise<void> {
  const { makeClient, syncRun } = await import("./sync.js");
  const store = new Store(DATA);
  const latest = store.readLatest<{ fetchedAt: string; jobs: ScoredJob[] }>();
  if (!latest) {
    console.error("No data yet - run `npm run fetch` first.");
    process.exit(1);
  }
  const classifier = new StubClassifier();
  const seeds = loadSeeds();
  const groups = seeds
    .map((company) => ({
      company,
      employerType: company.employerType ?? classifier.classifyEmployer(company.name).type,
      jobs: latest.jobs.filter((j) => j.companyToken === company.token && j.source === company.source),
    }))
    // A board that returned nothing this run is indistinguishable from a fetch
    // failure at this layer - skip it rather than close all its postings.
    .filter((g) => g.jobs.length > 0);
  const result = await syncRun(makeClient(), groups, latest.fetchedAt);
  console.log(
    `synced: ${result.companies} companies, ${result.postings} postings, ${result.snapshots} snapshots, ${result.closed} closed`,
  );
}

/** `rank`: score fit for every user profile and write today's top-N matches. */
async function rank(): Promise<void> {
  const { makeClient } = await import("./sync.js");
  const { rankAllUsers } = await import("./rank.js");
  const result = await rankAllUsers(makeClient());
  console.log(`ranked: ${result.users} users, ${result.matches} matches written`);
}

/** `discover`: probe ATSs for the company names in data/discovery.names.json. */
async function discoverCmd(): Promise<void> {
  const { discover } = await import("./discover.js");
  await discover(join(DATA, "discovery.names.json"), join(DATA, "companies.seed.json"));
}

/** `digest`: email each opted-in user their ranked list for today. */
async function digestCmd(): Promise<void> {
  const { makeClient } = await import("./sync.js");
  const { sendDigests } = await import("./digest.js");
  const result = await sendDigests(makeClient());
  console.log(`digest: ${result.sent} sent, ${result.skipped} skipped`);
}

/** `sponsors`: ingest US federal H-1B filings and join them to our companies. */
async function sponsorsCmd(): Promise<void> {
  const { makeClient } = await import("./sync.js");
  const { ingestSponsors, matchCompanies } = await import("./sponsorship.js");
  const db = makeClient();
  // USCIS publishes by fiscal year; take the last three so a company that
  // sponsored recently is still visible if this year's file lags.
  const thisFy = new Date().getUTCFullYear();
  const stored = await ingestSponsors(db, [thisFy, thisFy - 1, thisFy - 2]);
  const { matched, total } = await matchCompanies(db);
  console.log(`sponsors: ${stored} employer-years stored; ${matched}/${total} of our companies matched to federal filings`);
}

/** `sponsorpage`: regenerate the public sponsorship index served with the app. */
async function sponsorPageCmd(): Promise<void> {
  const { makeClient } = await import("./sync.js");
  const { buildSponsorPage } = await import("./sponsorpage.js");
  const out = join(ROOT, "..", "app", "public", "sponsors.html");
  const n = await buildSponsorPage(makeClient(), out);
  console.log(`sponsor page: ${n} employers -> app/public/sponsors.html`);
}

/** `stats`: write a small, publishable daily summary - the seed of the open ledger. */
function stats(): void {
  const store = new Store(DATA);
  const latest = store.readLatest<{ fetchedAt: string; jobs: ScoredJob[] }>();
  if (!latest) {
    console.error("No data yet - run `npm run fetch` first.");
    process.exit(1);
  }
  const summarize = (jobs: ScoredJob[]) => {
    const bands = { low: 0, medium: 0, high: 0, critical: 0 };
    const sponsor = { yes: 0, no: 0, unknown: 0 };
    let noSalary = 0;
    let stale90 = 0;
    for (const j of jobs) {
      bands[j.ghost.band]++;
      sponsor[j.sponsorship ?? "unknown"]++;
      if (!j.hasSalaryInfo) noSalary++;
      if (j.ghost.signals.some((s) => s.id === "stale_90d")) stale90++;
    }
    return { total: jobs.length, bands, sponsor, noSalary, stale90 };
  };
  const byCompany: Record<string, number> = {};
  for (const j of latest.jobs) byCompany[j.company] = (byCompany[j.company] ?? 0) + 1;
  const out = {
    date: latest.fetchedAt.slice(0, 10),
    fetchedAt: latest.fetchedAt,
    overall: summarize(latest.jobs),
    india: summarize(latest.jobs.filter((j) => matchesCountry(j.location, "in"))),
    usa: summarize(latest.jobs.filter((j) => matchesCountry(j.location, "us"))),
    byCompany,
  };
  mkdirSync(join(DATA, "stats"), { recursive: true });
  const file = join(DATA, "stats", `${out.date}.json`);
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`stats -> ${file}`);
}

/**
 * `feed`: write the slim public jobs feed the web app consumes.
 * India + US postings only, no descriptions - small enough to commit daily
 * and serve from GitHub raw. Every entry carries its ghost assessment with
 * human-readable reasons, because a score without reasons is just an opinion.
 */
async function feed(): Promise<void> {
  const store = new Store(DATA);
  const latest = store.readLatest<{ fetchedAt: string; jobs: ScoredJob[] }>();
  if (!latest) {
    console.error("No data yet - run `npm run fetch` first.");
    process.exit(1);
  }
  // Sponsorship facts live in the database (ingested monthly from USCIS) and
  // are keyed by company. Optional: without credentials the feed simply omits
  // them rather than failing - the rest of the feed is still worth publishing.
  const sponsorByCompany = new Map<string, { approvals: number; denials: number; fy: number; name: string }>();
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { makeClient } = await import("./sync.js");
      const { data } = await makeClient()
        .from("jr_companies")
        .select("name, sponsor_matched_name, h1b_approvals_recent, h1b_denials_recent, h1b_last_fiscal_year");
      for (const row of data ?? []) {
        const r = row as { name: string; sponsor_matched_name: string | null;
          h1b_approvals_recent: number | null; h1b_denials_recent: number | null;
          h1b_last_fiscal_year: number | null };
        if (r.h1b_approvals_recent && r.h1b_last_fiscal_year) {
          sponsorByCompany.set(r.name, {
            approvals: r.h1b_approvals_recent,
            denials: r.h1b_denials_recent ?? 0,
            fy: r.h1b_last_fiscal_year,
            name: r.sponsor_matched_name ?? r.name,
          });
        }
      }
      console.log(`  sponsorship facts for ${sponsorByCompany.size} companies`);
    } catch (err) {
      console.log(`  sponsorship facts unavailable: ${(err as Error).message}`);
    }
  }

  const entries = latest.jobs
    .map((j) => {
      const country = detectCountry(j.location);
      return country === null ? null : {
        key: j.key,
        company: j.company,
        title: j.title,
        location: j.location,
        country,
        url: j.url,
        source: j.source,
        publishedAt: j.publishedAt,
        firstSeenAt: j.firstSeenAt,
        ghost: { score: j.ghost.score, band: j.ghost.band, reasons: j.ghost.signals.map((s) => s.reason) },
        sponsorship: j.sponsorship ?? "unknown",
        hasSalaryInfo: j.hasSalaryInfo,
        tags: extractTags(j.title, j.description),
        sponsor: sponsorByCompany.get(j.company) ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const out = { generatedAt: latest.fetchedAt, total: entries.length, jobs: entries };
  writeFileSync(join(DATA, "feed.json"), JSON.stringify(out));
  console.log(`feed -> data/feed.json (${entries.length} India+US jobs of ${latest.jobs.length} total)`);
}

const cmd = process.argv[2];
const args = process.argv.slice(3);
let country: Country | null = null;
if (args.includes("--india") || args.includes("--country=in")) country = "in";
if (args.includes("--usa") || args.includes("--country=us")) country = "us";
switch (cmd) {
  case "probe": await probe(); break;
  case "fetch": await fetchAll(); break;
  case "report": report(country); break;
  case "stats": stats(); break;
  case "feed": await feed(); break;
  case "sync": await sync(); break;
  case "rank": await rank(); break;
  case "discover": await discoverCmd(); break;
  case "digest": await digestCmd(); break;
  case "sponsors": await sponsorsCmd(); break;
  case "sponsorpage": await sponsorPageCmd(); break;
  default:
    console.log("Usage: tsx src/cli.ts <probe|fetch|report|stats|feed|sync|rank|discover|digest|sponsors|sponsorpage> [--india | --usa]");
    process.exit(1);
}
