/**
 * Board discovery: turn company NAMES into verified board tokens by probing
 * the public endpoints of five ATSs with likely token variants. Only boards
 * that answer with at least one job are added. Runs in the daily Action's
 * network; results merge into companies.seed.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { SeedCompany, SourceName } from "./types.js";

interface Candidate { name: string; tokens?: string[] }

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

export async function discover(namesPath: string, seedPath: string): Promise<void> {
  const candidates: Candidate[] = JSON.parse(readFileSync(namesPath, "utf8"));
  const seeds: SeedCompany[] = JSON.parse(readFileSync(seedPath, "utf8"));
  const have = new Set(seeds.map((s) => `${s.source}|${s.token}`));

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
  console.log(`\ndiscover: ${done} probes, ${found.length} new boards -> ${seedPath}`);
}
