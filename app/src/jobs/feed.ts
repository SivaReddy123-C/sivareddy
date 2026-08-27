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

const CACHE_KEY = "jobradar.feed.v2";
// Short: users iterate on their profile in minutes, so a long cache makes the
// product look broken. Callers also revalidate in the background.
const CACHE_TTL_MS = 30 * 60 * 1000;
/** Above this a shard will not fit in localStorage alongside everything else. */
const MAX_CACHEABLE_BYTES = 3_500_000;

interface CacheEnvelope {
  cachedAt: number;
  countries: string[];
  feed: Feed;
}

export function readCache(): CacheEnvelope | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheEnvelope) : null;
  } catch {
    return null;
  }
}

/** Set by writeCache so the UI can say why a refresh did not stick. */
export let lastCacheNote = "";

function writeCache(feed: Feed, countries: string[]): void {
  const body = JSON.stringify({ cachedAt: Date.now(), countries, feed });
  if (body.length > MAX_CACHEABLE_BYTES) {
    // Say so rather than swallowing it. Silently failing to cache is how this
    // went unnoticed: every load looked like a first load, forever.
    lastCacheNote = `Too large to cache (${(body.length / 1048576).toFixed(1)}MB); `
      + "narrow your countries to keep it offline-ready.";
    return;
  }
  try {
    localStorage.setItem(CACHE_KEY, body);
    lastCacheNote = "";
  } catch {
    lastCacheNote = "Browser storage is full; the list still works but will reload each time.";
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

export async function loadFeed(force = false, countries?: string[]): Promise<Feed> {
  const want = (countries?.length ? countries : DEFAULT_COUNTRIES).map((c) => c.toLowerCase());
  const cached = readCache();
  const sameCountries = cached && cached.countries.join() === want.join();
  if (!force && cached && sameCountries && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.feed;
  }

  const index = await loadIndex();
  const available = new Set(index.shards.map((s) => s.country));
  const targets = want.filter((c) => available.has(c));

  const results = await Promise.all(targets.map((c) =>
    getJson<Shard>(`${BASE}/${c}.json`).then(expand).catch(() => [] as FeedJob[])));
  const jobs = results.flat();

  if (jobs.length === 0) {
    if (cached) return cached.feed; // stale beats nothing
    throw new Error("Feed not available yet");
  }
  const feed: Feed = { generatedAt: index.generatedAt, total: jobs.length, jobs };
  writeCache(feed, want);
  return feed;
}

/**
 * Stale-while-revalidate: hand back whatever is cached immediately so the UI
 * paints, then fetch in the background and call `onFresh` if the feed actually
 * changed. Nobody waits for a megabyte to download to see their list.
 */
export function loadFeedSWR(onFresh: (feed: Feed) => void, countries?: string[]): Feed | null {
  const cached = readCache();
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
