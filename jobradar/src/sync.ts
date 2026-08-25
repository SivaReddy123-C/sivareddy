/**
 * Sync a completed run into Supabase. Reads env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (service role - pipeline only,
 *   never shipped to a browser; RLS gives the anon key read-only access).
 *
 * Write path per run:
 *   1. upsert companies from the seed list
 *   2. upsert postings (first_seen_at preserved - only set on insert)
 *   3. append one snapshot row per posting (idempotent per run_date)
 *   4. mark postings closed when their board was fetched but the posting
 *      no longer appears - closure history is the scorecard's raw material
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { slotKey } from "./normalize.js";
import type { ScoredJob, SeedCompany } from "./types.js";

export interface CompanyRow {
  name: string;
  ats: string;
  board_token: string;
  employer_type: string;
  active: boolean;
  last_polled_at: string;
}

export function companyToRow(c: SeedCompany, employerType: string, polledAt: string): CompanyRow {
  return {
    name: c.name,
    ats: c.source,
    board_token: c.token,
    employer_type: employerType,
    active: true,
    last_polled_at: polledAt,
  };
}

export function jobToRow(j: ScoredJob, companyId: string) {
  return {
    company_id: companyId,
    source_job_id: j.sourceJobId,
    slot_key: slotKey(j.source, j.companyToken, j.title, j.location),
    title: j.title,
    location: j.location,
    country: null as string | null, // set by feed-country matching below when known
    remote: j.remote,
    url: j.url,
    apply_url: j.applyUrl,
    department: j.department,
    employment_type: j.employmentType,
    description_text: j.description,
    description_hash: j.description ? createHash("sha256").update(j.description).digest("hex").slice(0, 32) : null,
    has_salary: j.hasSalaryInfo,
    sponsorship: j.sponsorship ?? "unknown",
    posted_at: j.publishedAt,
    last_seen_at: new Date().toISOString(),
    closed_at: null as string | null,
    ghost_score: j.ghost.score,
    ghost_band: j.ghost.band,
    ghost_reasons: j.ghost.signals.map((s) => s.reason),
  };
}

export function snapshotRow(j: ScoredJob, postingId: string, runDate: string) {
  return {
    posting_id: postingId,
    run_date: runDate,
    ghost_score: j.ghost.score,
    ghost_reasons: j.ghost.signals.map((s) => s.reason),
    signals: j.ghost.signals,
    raw_hash: null as string | null,
  };
}

export function makeClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to sync");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function syncRun(
  db: SupabaseClient,
  seeds: { company: SeedCompany; employerType: string; jobs: ScoredJob[] }[],
  runIso: string,
): Promise<{ companies: number; postings: number; snapshots: number; closed: number }> {
  const runDate = runIso.slice(0, 10);
  let postings = 0, snapshots = 0, closed = 0;

  for (const { company, employerType, jobs } of seeds) {
    const { data: comp, error: cErr } = await db
      .from("jr_companies")
      .upsert(companyToRow(company, employerType, runIso), { onConflict: "ats,board_token" })
      .select("id")
      .single();
    if (cErr || !comp) throw new Error(`company upsert failed for ${company.name}: ${cErr?.message}`);

    // Upsert postings in chunks; first_seen_at defaults on insert and is never sent.
    const rows = jobs.map((j) => jobToRow(j, comp.id));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await db
        .from("jr_job_postings")
        .upsert(chunk, { onConflict: "company_id,source_job_id" });
      if (error) throw new Error(`posting upsert failed for ${company.name}: ${error.message}`);
      postings += chunk.length;
    }

    // Snapshot rows need posting ids. PostgREST caps responses at 1000 rows,
    // so paginate - Bosch alone has ~4800 postings.
    interface IdRow { id: string; source_job_id: string; closed_at: string | null }
    const idRows: IdRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("jr_job_postings")
        .select("id, source_job_id, closed_at")
        .eq("company_id", comp.id)
        .range(from, from + 999);
      if (error) throw new Error(`id fetch failed for ${company.name}: ${error.message}`);
      idRows.push(...((data ?? []) as IdRow[]));
      if (!data || data.length < 1000) break;
    }
    const idMap = new Map(idRows.map((r) => [r.source_job_id, r.id]));

    const snaps = jobs
      .map((j) => {
        const pid = idMap.get(j.sourceJobId);
        return pid ? snapshotRow(j, pid, runDate) : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    for (let i = 0; i < snaps.length; i += 500) {
      const chunk = snaps.slice(i, i + 500);
      const { error } = await db
        .from("jr_posting_snapshots")
        .upsert(chunk, { onConflict: "posting_id,run_date", ignoreDuplicates: true });
      if (error) throw new Error(`snapshot insert failed for ${company.name}: ${error.message}`);
      snapshots += chunk.length;
    }

    // Close postings that disappeared from a board we successfully fetched.
    // Computed client-side and closed by primary key in chunks - putting
    // hundreds of ids into a query-string filter 400s past ~700 jobs.
    const seen = new Set(jobs.map((j) => j.sourceJobId));
    const toClose = idRows.filter((r) => r.closed_at === null && !seen.has(r.source_job_id)).map((r) => r.id);
    for (let i = 0; i < toClose.length; i += 200) {
      const chunk = toClose.slice(i, i + 200);
      const { error } = await db
        .from("jr_job_postings")
        .update({ closed_at: runIso })
        .in("id", chunk);
      if (error) throw new Error(`close pass failed for ${company.name}: ${error.message}`);
      closed += chunk.length;
    }
  }
  return { companies: seeds.length, postings, snapshots, closed };
}
