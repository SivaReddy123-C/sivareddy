/**
 * Visa sponsorship facts from US federal records.
 *
 * Source: the USCIS H-1B Employer Data Hub, which publishes, per fiscal year
 * and per employer, how many H-1B petitions were approved and denied. This is
 * the one signal a job board structurally cannot fake and LinkedIn does not
 * show: not "this posting mentions sponsorship" but "this employer filed 340
 * petitions last year".
 *
 * Everything here is deterministic - download, parse, normalize, join. No
 * model, no inference. If a company cannot be matched we say so rather than
 * guessing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Guessed URL pattern - a fallback only; the real links are discovered. */
export function hubUrls(years: number[]): { year: number; url: string }[] {
  return years.map((year) => ({
    year,
    url: `https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-${year}.csv`,
  }));
}

const HUB_PAGES = [
  "https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub",
  "https://www.uscis.gov/archive/h-1b-employer-data-hub-files",
];

/**
 * Read the actual download links off the USCIS pages instead of guessing a URL
 * pattern. Federal sites reorganize; a scraped-then-verified link survives that,
 * and the fiscal year comes from the filename itself.
 */
export async function discoverHubUrls(): Promise<{ year: number; url: string }[]> {
  const found = new Map<number, string>();
  for (const page of HUB_PAGES) {
    try {
      const res = await fetch(page, { headers: { accept: "text/html" } });
      if (!res.ok) { console.log(`  hub page ${page} -> HTTP ${res.status}`); continue; }
      const html = await res.text();
      for (const m of html.matchAll(/href="([^"]+\.csv)"/gi)) {
        const href = m[1]!;
        if (!/h.?1b|datahub/i.test(href)) continue;
        const url = href.startsWith("http") ? href : `https://www.uscis.gov${href}`;
        const year = Number(/(20\d\d)/.exec(href)?.[1] ?? 0);
        if (year >= 2015 && !found.has(year)) found.set(year, url);
      }
    } catch (err) {
      console.log(`  hub page ${page} -> ${(err as Error).message}`);
    }
  }
  const list = [...found.entries()].map(([year, url]) => ({ year, url }))
    .sort((a, b) => b.year - a.year);
  console.log(`discovered ${list.length} fiscal-year files: ${list.map((l) => l.year).join(", ")}`);
  return list;
}

/** Minimal RFC4180-ish CSV reader: handles quoted fields and embedded commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const SUFFIXES =
  /\b(inc|inc\.|incorporated|llc|l\.l\.c|corp|corp\.|corporation|ltd|ltd\.|limited|co|co\.|company|lp|llp|plc|gmbh|pvt|private|holdings|group|usa|us|na|technologies|technology|labs|software|solutions|services|systems)\b/g;

/** Same company, different spelling: "STRIPE, INC." and "Stripe" must meet. */
export function normalizeEmployer(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SponsorRow {
  employer_norm: string;
  employer_name: string;
  fiscal_year: number;
  initial_approval: number;
  initial_denial: number;
  continuing_approval: number;
  continuing_denial: number;
  city: string | null;
  state: string | null;
}

const num = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/[^0-9-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Find a column by trying several header spellings USCIS has used. */
function columnFinder(header: string[]) {
  const norm = header.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return (...candidates: string[]): number => {
    for (const c of candidates) {
      const key = c.toLowerCase().replace(/[^a-z0-9]/g, "");
      const i = norm.indexOf(key);
      if (i !== -1) return i;
    }
    // Fall back to a contains-match so a renamed column still lands.
    for (const c of candidates) {
      const key = c.toLowerCase().replace(/[^a-z0-9]/g, "");
      const i = norm.findIndex((h) => h.includes(key));
      if (i !== -1) return i;
    }
    return -1;
  };
}

/** Parse one fiscal-year export into aggregated rows, one per employer. */
export function rowsFromCsv(csv: string, fiscalYear: number): SponsorRow[] {
  const table = parseCsv(csv);
  if (table.length < 2) return [];
  const header = table[0]!;
  const col = columnFinder(header);
  const iName = col("Employer (Petitioner) Name", "Employer", "Petitioner Name", "employername");
  const iInitA = col("Initial Approval", "Initial Approvals");
  const iInitD = col("Initial Denial", "Initial Denials");
  const iContA = col("Continuing Approval", "Continuing Approvals");
  const iContD = col("Continuing Denial", "Continuing Denials");
  const iCity = col("Petitioner City", "City");
  const iState = col("Petitioner State", "State");
  if (iName === -1) {
    throw new Error(`employer column not found; header was: ${header.join(" | ")}`);
  }

  // One employer can appear several times (multiple offices); sum them.
  const byNorm = new Map<string, SponsorRow>();
  for (let r = 1; r < table.length; r++) {
    const row = table[r]!;
    const name = (row[iName] ?? "").trim();
    if (!name) continue;
    const norm = normalizeEmployer(name);
    if (!norm) continue;
    const existing = byNorm.get(norm);
    const rec: SponsorRow = existing ?? {
      employer_norm: norm,
      employer_name: name,
      fiscal_year: fiscalYear,
      initial_approval: 0, initial_denial: 0,
      continuing_approval: 0, continuing_denial: 0,
      city: iCity === -1 ? null : (row[iCity] ?? null),
      state: iState === -1 ? null : (row[iState] ?? null),
    };
    rec.initial_approval += num(row[iInitA]);
    rec.initial_denial += num(row[iInitD]);
    rec.continuing_approval += num(row[iContA]);
    rec.continuing_denial += num(row[iContD]);
    byNorm.set(norm, rec);
  }
  return [...byNorm.values()];
}

async function fetchCsv(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "text/csv" } });
    if (!res.ok) {
      console.log(`  skip ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.log(`  skip ${url} -> ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Download the recent fiscal years and store per-employer petition counts. */
export async function ingestSponsors(db: SupabaseClient, years: number[]): Promise<number> {
  let stored = 0;
  // Prefer the links the site actually publishes; fall back to the pattern.
  const discovered = await discoverHubUrls();
  const wanted = discovered.length > 0
    ? discovered.filter((d) => years.includes(d.year)).slice(0, 3)
    : [];
  const targets = wanted.length > 0 ? wanted
    : discovered.length > 0 ? discovered.slice(0, 3)
    : hubUrls(years);
  for (const { year, url } of targets) {
    console.log(`fetching FY${year}: ${url}`);
    const csv = await fetchCsv(url);
    if (!csv) continue;
    const rows = rowsFromCsv(csv, year);
    console.log(`  FY${year}: ${rows.length} employers`);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await db
        .from("jr_sponsors")
        .upsert(chunk, { onConflict: "employer_norm,fiscal_year,source" });
      if (error) throw new Error(`sponsor upsert failed: ${error.message}`);
      stored += chunk.length;
    }
  }
  if (stored === 0) {
    throw new Error(
      "no sponsorship rows ingested - every download failed or parsed empty. " +
      "Check the logged URLs and header line above; refusing to report success.",
    );
  }
  return stored;
}

/**
 * Join federal filings to the companies we poll. Exact normalized match only -
 * a fuzzy match that mislabels an employer as a sponsor would be worse than no
 * label at all, because someone would apply on the strength of it.
 */
export async function matchCompanies(db: SupabaseClient): Promise<{ matched: number; total: number }> {
  const { data: companies, error } = await db.from("jr_companies").select("id, name");
  if (error) throw new Error(`company fetch failed: ${error.message}`);

  const sponsors: { employer_norm: string; employer_name: string; fiscal_year: number;
    initial_approval: number; continuing_approval: number; initial_denial: number;
    continuing_denial: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: sErr } = await db
      .from("jr_sponsors")
      .select("employer_norm, employer_name, fiscal_year, initial_approval, continuing_approval, initial_denial, continuing_denial")
      .order("employer_norm")
      .range(from, from + 999);
    if (sErr) throw new Error(`sponsor fetch failed: ${sErr.message}`);
    sponsors.push(...(data ?? []) as typeof sponsors);
    if (!data || data.length < 1000) break;
  }

  // Keep the most recent fiscal year per employer.
  const latest = new Map<string, (typeof sponsors)[number]>();
  for (const s of sponsors) {
    const cur = latest.get(s.employer_norm);
    if (!cur || s.fiscal_year > cur.fiscal_year) latest.set(s.employer_norm, s);
  }

  if (latest.size === 0) {
    console.log("no sponsor data present; leaving existing company facts untouched");
    return { matched: 0, total: (companies ?? []).length };
  }

  let matched = 0;
  const now = new Date().toISOString();
  for (const c of companies ?? []) {
    const hit = latest.get(normalizeEmployer(c.name as string));
    const patch = hit
      ? {
          sponsor_matched_name: hit.employer_name,
          h1b_approvals_recent: hit.initial_approval + hit.continuing_approval,
          h1b_denials_recent: hit.initial_denial + hit.continuing_denial,
          h1b_last_fiscal_year: hit.fiscal_year,
          sponsor_checked_at: now,
        }
      : { sponsor_matched_name: null, h1b_approvals_recent: null, h1b_denials_recent: null,
          h1b_last_fiscal_year: null, sponsor_checked_at: now };
    if (hit) matched++;
    const { error: uErr } = await db.from("jr_companies").update(patch).eq("id", c.id);
    if (uErr) throw new Error(`company sponsor update failed: ${uErr.message}`);
  }
  return { matched, total: (companies ?? []).length };
}
