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
}

export interface Feed {
  generatedAt: string;
  total: number;
  jobs: FeedJob[];
}

// Served from GitHub raw (free, CORS-enabled). main is canonical; the feature
// branch is a fallback so the tab works before the next merge to main.
const FEED_URLS = [
  "https://raw.githubusercontent.com/SivaReddy123-C/sivareddy/main/jobradar/data/feed.json",
  "https://raw.githubusercontent.com/SivaReddy123-C/sivareddy/claude/linkedin-api-auto-apply-dqpofk/jobradar/data/feed.json",
];

const CACHE_KEY = "jobradar.feed.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEnvelope {
  cachedAt: number;
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

function writeCache(feed: Feed): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), feed }));
  } catch {
    // Feed can be several hundred KB - if storage is full, live without the cache.
  }
}

export async function loadFeed(force = false): Promise<Feed> {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.feed;
  }
  let lastErr: unknown = new Error("Feed not available yet");
  for (const url of FEED_URLS) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const feed = (await res.json()) as Feed;
      if (!Array.isArray(feed.jobs)) { lastErr = new Error("Malformed feed"); continue; }
      writeCache(feed);
      return feed;
    } catch (err) {
      lastErr = err;
    }
  }
  if (cached) return cached.feed; // stale beats nothing
  throw lastErr;
}

export type SortKey = "ghost" | "newest" | "company";

export const COUNTRY_LABELS: Record<string, string> = {
  in: "India", us: "USA", gb: "UK", de: "Germany", nl: "Netherlands",
  ae: "UAE", ca: "Canada", sg: "Singapore", au: "Australia",
  se: "Sweden", fr: "France", ie: "Ireland",
};

export interface JobFilters {
  q: string;
  country: string; // "all" or a COUNTRY_LABELS key
  hideHighGhost: boolean;
  sponsorshipOnly: boolean;
  sort: SortKey;
}

export function defaultFilters(): JobFilters {
  return { q: "", country: "all", hideHighGhost: false, sponsorshipOnly: false, sort: "ghost" };
}

export function applyFilters(jobs: FeedJob[], f: JobFilters): FeedJob[] {
  const q = f.q.trim().toLowerCase();
  let out = jobs.filter((j) => {
    if (f.country !== "all" && j.country !== f.country) return false;
    if (f.hideHighGhost && (j.ghost.band === "high" || j.ghost.band === "critical")) return false;
    if (f.sponsorshipOnly && j.sponsorship === "no") return false;
    if (q && !`${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const posted = (j: FeedJob) => j.publishedAt ?? j.firstSeenAt;
  if (f.sort === "ghost") out = out.sort((a, b) => a.ghost.score - b.ghost.score || posted(b).localeCompare(posted(a)));
  if (f.sort === "newest") out = out.sort((a, b) => posted(b).localeCompare(posted(a)));
  if (f.sort === "company") out = out.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
  return out;
}
