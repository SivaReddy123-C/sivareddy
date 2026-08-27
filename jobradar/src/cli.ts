import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StubClassifier } from "./classify.js";
import { assessGhost } from "./ghost.js";
import { detectCountry, matchesCountry, slotKey, sponsorshipSignal, type Country } from "./normalize.js";
import { extractTags } from "./skills.js";
import { industryOf } from "./verticals.js";
import { greenhouse } from "./sources/greenhouse.js";
import { lever } from "./sources/lever.js";
import { ashby } from "./sources/ashby.js";
import { smartrecruiters } from "./sources/smartrecruiters.js";
import { workable } from "./sources/workable.js";
import { recruitee } from "./sources/recruitee.js";
import { workday } from "./sources/workday.js";
import { Store } from "./store.js";
import { isUsable } from "./types.js";
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
        const fetched = await adapter.fetchJobs(c);
        // The one place every adapter's output converges - see isUsable.
        const jobs = fetched.filter(isUsable);
        const dropped = fetched.length - jobs.length;
        results.push({ company: c, employerType, jobs });
        console.log(`fetched ${String(jobs.length).padStart(5)} jobs  ${c.name} (${c.source})`
          + (dropped > 0 ? `  [dropped ${dropped} unusable]` : ""));
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

/**
 * `coverage`: report, per user, which of their skills our inventory barely
 * serves. Advisory - it never fails the run, it just refuses to let a gap stay
 * invisible until the user finds it themselves.
 */
async function coverageCmd(): Promise<void> {
  const { makeClient } = await import("./sync.js");
  const { coverage, format } = await import("./coverage.js");
  const shardDir = join(ROOT, "data", "feed");
  const indexPath = join(shardDir, "index.json");
  if (!existsSync(indexPath)) throw new Error("no feed shards yet - run `npm run feed` first");
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as { shards: { country: string; file: string }[] };
  const jobs = index.shards.flatMap((sh) => {
    const shard = JSON.parse(readFileSync(join(shardDir, sh.file), "utf8")) as
      { jobs: { tags?: string[]; title: string }[] };
    return shard.jobs.map((j) => ({ tags: j.tags, title: j.title, country: sh.country }));
  });
  const feed = { jobs };
  const reports = await coverage(makeClient(), feed);
  if (reports.length === 0) { console.log("coverage: no profiles yet"); return; }
  for (const r of reports) console.log(format(r));
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

/**
 * `sponsorpage`: regenerate the public sponsorship index served with the app.
 *
 * Built from the committed feed, not the database. The feed already carries the
 * sponsorship facts, so the page cannot be held hostage by a failed sync.
 */
async function sponsorPageCmd(): Promise<void> {
  const { buildSponsorPageFromFeed } = await import("./sponsorpage.js");
  const shardDir = join(ROOT, "data", "feed");
  const indexPath = join(shardDir, "index.json");
  if (!existsSync(indexPath)) throw new Error("no feed shards yet - run `npm run feed` first");
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as
    { generatedAt: string; shards: { country: string; file: string }[] };
  // The index knows every shard; the page is a view over all of them.
  const jobs = index.shards.flatMap((sh) => {
    const shard = JSON.parse(readFileSync(join(shardDir, sh.file), "utf8")) as
      { sponsors: Record<string, { approvals: number; denials: number; fy: number; name: string }>;
        jobs: { company: string }[] };
    return shard.jobs.map((j) => ({
      company: j.company, country: sh.country, sponsor: shard.sponsors[j.company] ?? null,
    }));
  });
  const feed = { generatedAt: index.generatedAt, jobs };

  const metaPath = join(ROOT, "data", "sponsor-meta.json");
  const meta = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, "utf8")) as { federalRecords: number; ingestedAt: string })
    : null;

  const out = join(ROOT, "..", "app", "public", "sponsors.html");
  const n = buildSponsorPageFromFeed(feed, meta, out);
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
        // What the employer does, from the curated list - not inferred from
        // posting text, which cannot tell "is a hotel company" from "sells to
        // hotel companies".
        industry: industryOf(j.company),
        sponsor: sponsorByCompany.get(j.company) ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  // Shard by country.
  //
  // The single feed reached 24.6 MB. A browser cannot cache that - localStorage
  // caps near 5 MB - so every refresh re-downloaded and re-parsed the whole
  // thing and the cache write failed silently every time. It also committed
  // 24.6 MB into git nightly. Nobody needs 20,000 US postings to look at jobs
  // in Singapore; they need their own countries.
  const shardDir = join(DATA, "feed");
  mkdirSync(shardDir, { recursive: true });
  const byCountry = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = e.country ?? "other";
    const bucket = byCountry.get(key);
    if (bucket) bucket.push(e);
    else byCountry.set(key, [e]);
  }

  const shards: { country: string; jobs: number; bytes: number; file: string }[] = [];
  for (const [country, jobs] of [...byCountry.entries()].sort()) {
    const file = `${country}.json`;

    // Hoist what repeats. Sponsorship facts are identical for every posting at
    // an employer, and the country is constant inside its own shard - together
    // they were about a tenth of the payload for nothing.
    const sponsors: Record<string, NonNullable<typeof jobs[number]["sponsor"]>> = {};
    const industries: Record<string, string> = {};
    const slim = jobs.map((j) => {
      if (j.sponsor) sponsors[j.company] = j.sponsor;
      if (j.industry) industries[j.company] = j.industry;
      const { country: _c, sponsor: _s, industry: _i, ...rest } = j;
      return {
        ...rest,
        // Whole dates: nothing in the UI shows the time, and an ISO timestamp
        // is more than twice as long.
        publishedAt: j.publishedAt ? j.publishedAt.slice(0, 10) : null,
        firstSeenAt: j.firstSeenAt.slice(0, 10),
        // Reasons explain a risk score. A posting with no risk has nothing to
        // explain, and those are the majority.
        ghost: j.ghost.band === "low"
          ? { score: j.ghost.score, band: j.ghost.band, reasons: [] }
          : j.ghost,
      };
    });

    const body = JSON.stringify({
      generatedAt: latest.fetchedAt, country, total: slim.length, sponsors, industries, jobs: slim,
    });
    writeFileSync(join(shardDir, file), body);
    shards.push({ country, jobs: slim.length, bytes: body.length, file });
  }
  shards.sort((a, b) => b.jobs - a.jobs);

  const index = { generatedAt: latest.fetchedAt, total: entries.length, shards };
  writeFileSync(join(shardDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);

  const mb = (n: number) => `${(n / 1048576).toFixed(1)}MB`;
  console.log(`feed -> data/feed/ (${entries.length} jobs in ${shards.length} country shards)`);
  for (const sh of shards.slice(0, 8)) {
    console.log(`  ${sh.country.padEnd(6)} ${String(sh.jobs).padStart(6)} jobs  ${mb(sh.bytes)}`);
  }
  const largest = shards[0];
  if (largest && largest.bytes > 8 * 1048576) {
    console.log(`  warning: ${largest.country} is ${mb(largest.bytes)}; browsers cannot cache a shard this size`);
  }
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
  case "coverage": await coverageCmd(); break;
  default:
    console.log("Usage: tsx src/cli.ts <probe|fetch|report|stats|feed|sync|rank|discover|digest|sponsors|sponsorpage|coverage> [--india | --usa]");
    process.exit(1);
}
