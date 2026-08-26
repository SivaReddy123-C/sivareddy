import { useEffect, useMemo, useState } from "react";
import { daysSince } from "../lib/stats.js";
import { uid } from "../lib/storage.js";
import { buildApplicationPack } from "../lib/pack.js";
import type { AnswerEntry, Application, ResumeData } from "../lib/types.js";
import {
  COUNTRY_LABELS, applyFilters, defaultFilters, loadFeed, readCache,
  type Feed, type FeedJob, type JobFilters,
} from "./feed.js";

const PAGE = 50;

interface Props {
  applications: Application[];
  onChange: (apps: Application[]) => void;
  resume: ResumeData;
  answers: AnswerEntry[];
}

export function JobsPage({ applications, onChange, resume, answers }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  async function copyPack(key: string) {
    await navigator.clipboard.writeText(buildApplicationPack(resume, answers));
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }
  const [feed, setFeed] = useState<Feed | null>(() => readCache()?.feed ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<JobFilters>(defaultFilters());
  const [limit, setLimit] = useState(PAGE);

  async function refresh(force: boolean) {
    setLoading(true);
    setError("");
    try {
      setFeed(await loadFeed(force));
    } catch (err) {
      setError(`Couldn't load the jobs feed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(false); }, []);
  useEffect(() => setLimit(PAGE), [filters]);

  const appliedUrls = useMemo(
    () => new Set(applications.map((a) => a.url).filter(Boolean)),
    [applications],
  );

  function logApplied(job: FeedJob) {
    const now = new Date().toISOString();
    onChange([
      {
        id: uid(),
        company: job.company,
        title: job.title,
        url: job.url,
        location: job.location,
        source: "jobradar",
        appliedAt: now,
        status: "applied",
        statusChangedAt: now,
        notes: "",
      },
      ...applications,
    ]);
  }

  const visible = useMemo(
    () => (feed ? applyFilters(feed.jobs, filters) : []),
    [feed, filters],
  );

  return (
    <div className="jobs">
      <div className="jobs-toolbar">
        <input
          className="jobs-search"
          placeholder="Search title, company, location..."
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <select value={filters.country}
          onChange={(e) => setFilters({ ...filters, country: e.target.value })}>
          <option value="all">All countries</option>
          {Object.entries(COUNTRY_LABELS).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
        <select value={filters.sort}
          onChange={(e) => setFilters({ ...filters, sort: e.target.value as JobFilters["sort"] })}>
          <option value="ghost">Least ghost risk first</option>
          <option value="newest">Newest first</option>
          <option value="company">Company A–Z</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={filters.hideHighGhost}
            onChange={(e) => setFilters({ ...filters, hideHighGhost: e.target.checked })} />
          Hide likely ghosts
        </label>
        <label className="check" title='Hides postings whose description explicitly says no visa sponsorship. "Doesn&apos;t say" is kept - most postings don&apos;t state it.'>
          <input type="checkbox" checked={filters.sponsorshipOnly}
            onChange={(e) => setFilters({ ...filters, sponsorshipOnly: e.target.checked })} />
          Hide "won't sponsor visa"
        </label>
        <button onClick={() => refresh(true)} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {feed && (
        <p className="jobs-meta">
          {visible.length} of {feed.total} postings · data from official ATS APIs, updated daily ·
          snapshot {feed.generatedAt.slice(0, 10)} · ghost scores are heuristics with reasons shown — judge for yourself
        </p>
      )}
      {error && <p className="jobs-error">{error} {feed ? "(showing cached data)" : "— the feed appears after the first daily fetch publishes it."}</p>}
      {!feed && !error && loading && <p className="jobs-meta">Loading jobs feed...</p>}

      <div className="job-list">
        {visible.slice(0, limit).map((j) => {
          const applied = appliedUrls.has(j.url);
          const posted = j.publishedAt ?? j.firstSeenAt;
          return (
            <div className={`card job-card ghost-${j.ghost.band}`} key={j.key}>
              <div className="job-main">
                <div className="job-title">
                  <strong>{j.company}</strong> · {j.title}
                </div>
                <div className="job-meta">
                  {j.location} · posted {daysSince(posted)}d ago
                  {j.hasSalaryInfo && <span className="tag tag-salary">salary stated</span>}
                  {j.sponsorship === "yes" && <span className="tag tag-sponsor">sponsors visa</span>}
                  {j.sponsorship === "no" && <span className="tag tag-nosponsor">won't sponsor</span>}
                </div>
                {j.ghost.reasons.length > 0 && (
                  <details className="ghost-details">
                    <summary>
                      <GhostBadge band={j.ghost.band} score={j.ghost.score} /> why?
                    </summary>
                    <ul>
                      {j.ghost.reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </details>
                )}
                {j.ghost.reasons.length === 0 && <GhostBadge band={j.ghost.band} score={j.ghost.score} />}
              </div>
              <div className="job-actions">
                <a className="btn-link" href={j.url} target="_blank" rel="noreferrer">Open posting ↗</a>
                <button onClick={() => copyPack(j.key)} title="Contact info + standard answers, ready to paste">
                  {copiedKey === j.key ? "Copied ✓" : "Copy pack"}
                </button>
                {applied ? (
                  <span className="applied-mark">Logged ✓</span>
                ) : (
                  <button className="primary" onClick={() => logApplied(j)}
                    title="Adds this job to your tracker as applied today">
                    I applied — log it
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {visible.length > limit && (
        <button className="load-more" onClick={() => setLimit((n) => n + PAGE)}>
          Show more ({visible.length - limit} remaining)
        </button>
      )}
    </div>
  );
}

function GhostBadge({ band, score }: { band: FeedJob["ghost"]["band"]; score: number }) {
  const label = { low: "looks live", medium: "some doubt", high: "ghost risk", critical: "likely ghost" }[band];
  return <span className={`ghost-badge-pill pill-${band}`}>{label} · {score}</span>;
}
