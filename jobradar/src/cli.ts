import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessGhost } from "./ghost.js";
import { looksIndian } from "./normalize.js";
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
  const all: ScoredJob[] = [];
  for (const c of seeds) {
    const adapter = adapters[c.source]!;
    try {
      const jobs = await adapter.fetchJobs(c);
      store.record(jobs);
      for (const job of jobs) {
        const history = store.historyFor(job);
        all.push({
          ...job,
          firstSeenAt: history?.firstSeenAt ?? new Date().toISOString(),
          lastSeenAt: history?.lastSeenAt ?? new Date().toISOString(),
          ghost: assessGhost(job, history),
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

function report(indiaOnly: boolean): void {
  const store = new Store(DATA);
  const latest = store.readLatest<{ fetchedAt: string; jobs: ScoredJob[] }>();
  if (!latest) {
    console.error("No data yet - run `npm run fetch` first.");
    process.exit(1);
  }
  let jobs = latest.jobs;
  if (indiaOnly) jobs = jobs.filter((j) => looksIndian(j.location));

  console.log(`Snapshot from ${latest.fetchedAt} - ${jobs.length} jobs${indiaOnly ? " (India)" : ""}\n`);

  const byBand = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const j of jobs) byBand[j.ghost.band]++;
  console.log("Ghost-risk distribution:");
  for (const [band, n] of Object.entries(byBand)) {
    const pct = jobs.length ? ((n / jobs.length) * 100).toFixed(1) : "0.0";
    console.log(`  ${band.padEnd(9)} ${String(n).padStart(5)}  (${pct}%)`);
  }

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

const cmd = process.argv[2];
const indiaOnly = process.argv.includes("--india");
switch (cmd) {
  case "probe": await probe(); break;
  case "fetch": await fetchAll(); break;
  case "report": report(indiaOnly); break;
  default:
    console.log("Usage: tsx src/cli.ts <probe|fetch|report> [--india]");
    process.exit(1);
}
