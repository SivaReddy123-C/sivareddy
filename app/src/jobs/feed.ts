/** Types and fetch/cache logic for the public jobs feed the daily Action publishes. */

export interface FeedJob {
  key: string;
  company: string;
  title: string;
  location: string;
  country: string;
  url: string;
  source: string;
  publishedAt: string | null;
  firstSeenAt: string;
  ghost: { score: number; band: "low" | "medium" | "high" | "critical"; reasons: string[] };
  sponsorship: "yes" | "no" | "unknown";
  hasSalaryInfo: boolean;
  /** Canonical skill/role tags extracted from the posting by the pipeline. */
  tags?: string[];
  /**
   * H-1B petitions this employer actually filed, from USCIS federal records.
   * Absent means no filings were found for that fiscal year - which is
   * evidence, not proof, that they do not sponsor.
   */
  sponsor?: { approvals: number; denials: number; fy: number; name: string } | null;
  /** The vertical this employer operates in, from the curated list. */
  industry?: string | null;
}

export interface Feed {
  generatedAt: string;
  total: number;
  jobs: FeedJob[];
}

// Served from GitHub raw (free, CORS-enabled).
//
// Sharded by country. The single feed reached 24.6 MB, which a browser cannot
// cache - localStorage caps near 5 MB - so every refresh re-downloaded and
// re-parsed the whole file and the cache write failed silently every time.
// That is what "nothing synced and refreshed" looked like from the outside.
const BASE = "https://raw.githubusercontent.com/SivaReddy123-C/sivareddy/main/jobradar/data/feed";

/** Countries fetched when the user has expressed no preference. */
const DEFAULT_COUNTRIES = ["in", "us", "gb", "de", "sg", "ae", "ca", "nl"];

export interface ShardIndex {
  generatedAt: string;
  total: number;
  shards: { country: string; jobs: number; bytes: number; file: string }[];
}

interface Shard {
  generatedAt: string;
  country: string;
  total: number;
  sponsors: Record<string, NonNullable<FeedJob["sponsor"]>>;
  industries: Record<string, string>;
  jobs: Omit<FeedJob, "country" | "sponsor" | "industry">[];
}

// One cache entry per country, not one for the whole selection.
//
// A single blob meant adding a seventh country pushed the total past what
// localStorage would take and the ENTIRE cache was refused - so widening a
// search made the app slower, which is precisely backwards. Per shard, adding
// a country costs only that country, and one oversized shard (the US is 10MB)
// simply does not cache while every other one still does.
const SHARD_KEY = (c: string) => `jobradar.shard.v3.${c}`;
const CACHE_TTL_MS = 30 * 60 * 1000;
/** No single shard above this is worth trying to store. */
const MAX_SHARD_BYTES = 2_500_000;

interface ShardEnvelope { cachedAt: number; shard: Shard }

/** Set when a shard could not be stored, so the UI can say why. */
export let lastCacheNote = "";

function readShardCache(country: string): Shard | null {
  try {
    const raw = localStorage.getItem(SHARD_KEY(country));
    if (!raw) return null;
    const env = JSON.parse(raw) as ShardEnvelope;
    return Date.now() - env.cachedAt < CACHE_TTL_MS ? env.shard : null;
  } catch {
    // silent-ok: an unreadable cache entry is the same as a miss, and the
    // shard is about to be refetched anyway.
    return null;
  }
}

/** Drop other cached shards, oldest first, to make room. */
function evictOldestShard(except: string): boolean {
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith("jobradar.shard.v3.") || k === SHARD_KEY(except)) continue;
    try {
      const env = JSON.parse(localStorage.getItem(k) ?? "{}") as ShardEnvelope;
      if (env.cachedAt < oldestAt) { oldestAt = env.cachedAt; oldestKey = k; }
    } catch {
      // silent-ok: unparseable entry - evicting it is exactly what we want.
      oldestKey = k; oldestAt = 0;
    }
  }
  if (!oldestKey) return false;
  localStorage.removeItem(oldestKey);
  return true;
}

function writeShardCache(country: string, shard: Shard): void {
  const body = JSON.stringify({ cachedAt: Date.now(), shard });
  if (body.length > MAX_SHARD_BYTES) {
    lastCacheNote = `${country.toUpperCase()} is too large to keep offline `
      + `(${(body.length / 1048576).toFixed(1)}MB); it reloads each time.`;
    return;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(SHARD_KEY(country), body);
      return;
    } catch {
      // silent-ok: quota is expected here; we handle it by evicting and
      // retrying, and report below if that does not work.
      if (!evictOldestShard(country)) break;
    }
  }
  lastCacheNote = "Browser storage is full; some countries reload each time.";
}

/** Remove cache entries written by older versions of this code. */
function dropLegacyCaches(): void {
  for (const k of ["jobradar.feed.v1", "jobradar.feed.v2"]) {
    try {
      localStorage.removeItem(k);
    } catch {
      // silent-ok: nothing depends on the old key going away.
    }
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function loadIndex(): Promise<ShardIndex> {
  return getJson<ShardIndex>(`${BASE}/index.json`);
}

/** Re-attach what the shard hoisted out, so callers still see whole jobs. */
function expand(shard: Shard): FeedJob[] {
  return shard.jobs.map((j) => ({
    ...j,
    country: shard.country,
    sponsor: shard.sponsors[j.company] ?? null,
    industry: shard.industries[j.company] ?? null,
  }) as FeedJob);
}

/** Whatever is already cached for these countries, without touching the network. */
export function readCache(countries?: string[]): { feed: Feed } | null {
  const want = (countries?.length ? countries : DEFAULT_COUNTRIES).map((c) => c.toLowerCase());
  const jobs: FeedJob[] = [];
  let generatedAt = "";
  for (const c of want) {
    const shard = readShardCache(c);
    if (!shard) continue;
    jobs.push(...expand(shard));
    if (shard.generatedAt > generatedAt) generatedAt = shard.generatedAt;
  }
  return jobs.length > 0 ? { feed: { generatedAt, total: jobs.length, jobs } } : null;
}

export async function loadFeed(force = false, countries?: string[]): Promise<Feed> {
  dropLegacyCaches();
  const want = (countries?.length ? countries : DEFAULT_COUNTRIES).map((c) => c.toLowerCase());

  const index = await loadIndex();
  const available = new Set(index.shards.map((s) => s.country));
  const targets = want.filter((c) => available.has(c));
  if (targets.length === 0) {
    throw new Error(`No feed for ${want.join(", ").toUpperCase()} yet - the countries on your profile have no postings in this run.`);
  }

  const failed: string[] = [];
  const results = await Promise.all(targets.map(async (c) => {
    if (!force) {
      const hit = readShardCache(c);
      if (hit) return expand(hit);
    }
    try {
      const shard = await getJson<Shard>(`${BASE}/${c}.json`);
      writeShardCache(c, shard);
      return expand(shard);
    } catch {
      // silent-ok per shard, reported in aggregate below: one country failing
      // must not deny the user the other six.
      failed.push(c);
      const stale = readShardCache(c);
      return stale ? expand(stale) : [];
    }
  }));
  const jobs = results.flat();

  if (jobs.length === 0) {
    throw new Error(failed.length > 0
      ? `Could not load ${failed.join(", ").toUpperCase()}`
      : "Feed not available yet");
  }
  if (failed.length > 0) {
    lastCacheNote = `Could not refresh ${failed.join(", ").toUpperCase()}; showing what loaded.`;
  }
  return { generatedAt: index.generatedAt, total: jobs.length, jobs };
}

/**
 * Stale-while-revalidate: hand back whatever is cached immediately so the UI
 * paints, then fetch in the background and call `onFresh` if the feed actually
 * changed. Nobody waits for a megabyte to download to see their list.
 */
export function loadFeedSWR(onFresh: (feed: Feed) => void, countries?: string[]): Feed | null {
  const cached = readCache(countries);
  void (async () => {
    try {
      const fresh = await loadFeed(true, countries);
      if (!cached || fresh.generatedAt !== cached.feed.generatedAt) onFresh(fresh);
    } catch {
      // silent-ok: background revalidation. The cached feed is already on
      // screen, and a foreground load reports its own failures.
    }
  })();
  return cached?.feed ?? null;
}

export type SortKey = "ghost" | "newest" | "company";

export const COUNTRY_LABELS: Record<string, string> = {
  in: "India", us: "USA", gb: "UK", de: "Germany", nl: "Netherlands",
  ae: "UAE", ca: "Canada", sg: "Singapore", au: "Australia",
  se: "Sweden", fr: "France", ie: "Ireland",
  th: "Thailand", my: "Malaysia", ph: "Philippines", id: "Indonesia",
  vn: "Vietnam", jp: "Japan", kr: "South Korea", tw: "Taiwan",
  hk: "Hong Kong", cn: "China", sa: "Saudi Arabia", qa: "Qatar",
  eg: "Egypt", il: "Israel", tr: "Turkey", za: "South Africa",
  ke: "Kenya", nz: "New Zealand", es: "Spain", it: "Italy",
  pl: "Poland", pt: "Portugal", ch: "Switzerland", dk: "Denmark",
  no: "Norway", fi: "Finland", be: "Belgium", at: "Austria",
  cz: "Czechia", ro: "Romania", br: "Brazil", mx: "Mexico",
  ar: "Argentina", cl: "Chile", co: "Colombia",
};

export interface JobFilters {
  q: string;
  country: string; // "all" or a COUNTRY_LABELS key
  hideHighGhost: boolean;
  sponsorshipOnly: boolean;
  /** Only employers with H-1B petitions on federal record. */
  sponsorsOnly: boolean;
  sort: SortKey;
}

export function defaultFilters(): JobFilters {
  return { q: "", country: "all", hideHighGhost: false, sponsorshipOnly: false, sponsorsOnly: false, sort: "ghost" };
}

export function applyFilters(jobs: FeedJob[], f: JobFilters): FeedJob[] {
  const q = f.q.trim().toLowerCase();
  let out = jobs.filter((j) => {
    if (f.country !== "all" && j.country !== f.country) return false;
    if (f.hideHighGhost && (j.ghost.band === "high" || j.ghost.band === "critical")) return false;
    if (f.sponsorshipOnly && j.sponsorship === "no") return false;
    if (f.sponsorsOnly && !(j.sponsor && j.sponsor.approvals > 0)) return false;
    if (q && !`${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const posted = (j: FeedJob) => j.publishedAt ?? j.firstSeenAt;
  if (f.sort === "ghost") out = out.sort((a, b) => a.ghost.score - b.ghost.score || posted(b).localeCompare(posted(a)));
  if (f.sort === "newest") out = out.sort((a, b) => posted(b).localeCompare(posted(a)));
  if (f.sort === "company") out = out.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
  return out;
}
