import type { GhostAssessment, GhostSignal, Job, JobHistory } from "./types.js";

const DAY = 24 * 60 * 60 * 1000;

const EVERGREEN_TITLE =
  /talent (pool|community|network|pipeline)|general application|future (opportunit|opening)|open application|evergreen|expression of interest/i;

/**
 * Score how likely a posting is a "ghost job" - one that will never hire anyone.
 *
 * Every signal is a heuristic, individually weak; the score is only meaningful
 * in aggregate and improves as longitudinal history accrues in the store.
 * Weights are deliberately published and explained - if we flag a company's
 * posting, anyone (including that company) can see exactly why.
 */
/**
 * @param concurrentOpen how many postings share this job's slot in the CURRENT
 * snapshot. Multiple ids for a slot only indicate repost churn when there are
 * more historical ids than concurrently open copies - identical roles open at
 * the same time are multiple headcount, not reposts.
 */
export function assessGhost(job: Job, history: JobHistory | null, now = new Date(), concurrentOpen = 1): GhostAssessment {
  const signals: GhostSignal[] = [];
  const nowMs = now.getTime();

  // 1) Staleness: how long has this exact posting been up?
  //    Prefer the source's own published date; fall back to when we first saw it.
  const postedAt = job.publishedAt ?? history?.firstSeenAt ?? null;
  if (postedAt) {
    const days = Math.floor((nowMs - new Date(postedAt).getTime()) / DAY);
    if (days >= 90) {
      signals.push({ id: "stale_90d", weight: 40, reason: `Open for ${days} days without being filled or closed` });
    } else if (days >= 45) {
      signals.push({ id: "stale_45d", weight: 20, reason: `Open for ${days} days` });
    }
  }

  // 2) Evergreen/pipeline postings never map to a real open headcount.
  if (EVERGREEN_TITLE.test(job.title)) {
    signals.push({ id: "evergreen_title", weight: 40, reason: `Title suggests a talent pipeline, not a live role: "${job.title}"` });
  }

  // 3) Repost churn: same role slot cycling through new job ids.
  if (history && history.seenIds.length > Math.max(concurrentOpen, 1)) {
    signals.push({
      id: "reposted",
      weight: 25,
      reason: `Role has cycled through ${history.seenIds.length} job ids (${concurrentOpen} currently open)`,
    });
  }

  // 4) No salary information. Weak alone (very common), meaningful combined.
  if (!job.hasSalaryInfo) {
    signals.push({ id: "no_salary", weight: 10, reason: "No salary/compensation information" });
  }

  // 5) Thin description: real reqs describe real work.
  //    Only assess when the source actually gave us a description.
  if (job.description !== null && job.description.length < 500) {
    signals.push({ id: "thin_description", weight: 15, reason: `Description is only ${job.description.length} characters` });
  }

  // 6) No location at all.
  if (!job.location.trim()) {
    signals.push({ id: "no_location", weight: 10, reason: "No location given" });
  }

  const score = Math.min(100, signals.reduce((s, x) => s + x.weight, 0));
  return { score, band: band(score), signals };
}

function band(score: number): GhostAssessment["band"] {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}
