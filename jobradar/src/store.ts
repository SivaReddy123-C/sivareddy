import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { slotKey } from "./normalize.js";
import type { Job, JobHistory } from "./types.js";

/**
 * Tiny file-backed store. state.json tracks per-slot history across runs -
 * that history is what turns one-off snapshots into ghost-detection evidence.
 * A slot is (source, company, title, location); ids may change across reposts.
 */
export class Store {
  private state: Record<string, JobHistory>;

  constructor(private dir: string) {
    mkdirSync(join(dir, "snapshots"), { recursive: true });
    const statePath = this.path("state.json");
    this.state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  historyFor(job: Job): JobHistory | null {
    return this.state[slotKey(job.source, job.companyToken, job.title, job.location)] ?? null;
  }

  /** Record this run's jobs, updating first/last-seen and the set of ids per slot. */
  record(jobs: Job[], now = new Date()): void {
    const iso = now.toISOString();
    for (const job of jobs) {
      const key = slotKey(job.source, job.companyToken, job.title, job.location);
      const h = this.state[key];
      if (!h) {
        this.state[key] = { firstSeenAt: job.publishedAt ?? iso, lastSeenAt: iso, seenIds: [job.sourceJobId] };
      } else {
        h.lastSeenAt = iso;
        if (!h.seenIds.includes(job.sourceJobId)) h.seenIds.push(job.sourceJobId);
      }
    }
    writeFileSync(this.path("state.json"), JSON.stringify(this.state, null, 1));
    const day = iso.slice(0, 10);
    // Snapshots stay slim (no descriptions/urls) so a daily archive stays small;
    // latest.json keeps the full records for the current run.
    const slim = jobs.map(({ key, source, company, companyToken, sourceJobId, title, location, publishedAt, updatedAt, hasSalaryInfo }) =>
      JSON.stringify({ key, source, company, companyToken, sourceJobId, title, location, publishedAt, updatedAt, hasSalaryInfo }));
    writeFileSync(this.path(join("snapshots", `${day}.jsonl`)), slim.join("\n") + "\n");
  }

  writeLatest(payload: unknown): void {
    writeFileSync(this.path("latest.json"), JSON.stringify(payload, null, 1));
  }

  readLatest<T>(): T | null {
    const p = this.path("latest.json");
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
  }
}
