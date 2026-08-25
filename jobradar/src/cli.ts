import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StubClassifier } from "./classify.js";
import { assessGhost } from "./ghost.js";
import { matchesCountry, slotKey, sponsorshipSignal, type Country } from "./normalize.js";
import { greenhouse } from "./sources/greenhouse.js";
import { lever } from "./sources/lever.js";
import { ashby } from "./sources/ashby.js";
import { smartrecruiters } from "./sources/smartrecruiters.js";
import { Store } from "./store.js";
import type { ScoredJob, SeedCompany, SourceAdapter } from "./types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const adapters: Record<string, SourceAdapter> = { greenhouse, lever, ashby, smartrecruiters };

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
  const all: ScoredJob[] = [];
  for (const c of seeds) {
    const employerType = c.employerType ?? classifier.classifyEmployer(c.name).type;
    const adapter = adapters[c.source]!;
    try {
      const jobs = await adapter.fetchJobs(c);
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
      console.log(`fetched ${String(jobs.length).padStart(4)} jobs  ${c.name} (${c.source})`);
    } catch (err) {
      console.error(`ERROR ${c.name} (${c.source}/${c.token}): ${(err as Error).message}`);
    }
  }
  store.writeLatest({ fetchedAt: new Date().toISOString(), jobs: all });
  console.log(`\nTotal: ${all.length} jobs -> data/latest.json`);
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
function feed(): void {
  const store = new Store(DATA);
  const latest = store.readLatest<{ fetchedAt: string; jobs: ScoredJob[] }>();
  if (!latest) {
    console.error("No data yet - run `npm run fetch` first.");
    process.exit(1);
  }
  const entries = latest.jobs
    .map((j) => {
      const country = matchesCountry(j.location, "in") ? "in" : matchesCountry(j.location, "us") ? "us" : null;
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
  case "feed": feed(); break;
  case "sync": await sync(); break;
  default:
    console.log("Usage: tsx src/cli.ts <probe|fetch|report|stats|feed|sync> [--india | --usa]");
    process.exit(1);
}
