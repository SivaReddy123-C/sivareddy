import type { GhostAssessment, GhostSignal, Job, JobHistory } from "./types.js";

const DAY = 24 * 60 * 60 * 1000;

const AGENCY_TEXT =
  /multiple locations|various clients|our clients?\b|building (a |our )?(talent )?pipeline|staff(ing)? augmentation|corp[- ]to[- ]corp|\bc2c\b|w2 candidates/i;

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
 * @param employerType stored classification of the employer (never computed
 * here - scoring stays deterministic; the classifier runs upstream and caches).
 */
export function assessGhost(job: Job, history: JobHistory | null, now = new Date(), concurrentOpen = 1, employerType = "unknown"): GhostAssessment {
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
    } else if (days >= 14) {
      signals.push({ id: "stale_14d", weight: 10, reason: `Open for ${days} days - freshness decays after two weeks` });
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

  // 7) Staffing/consultancy postings are routinely pipeline-builders.
  if (employerType === "staffing" || employerType === "agency") {
    signals.push({ id: "staffing_employer", weight: 25, reason: "Employer is a staffing/recruiting agency" });
  } else if (employerType === "consultancy") {
    signals.push({ id: "consultancy_employer", weight: 15, reason: "Employer is a consultancy - postings often pool candidates for future client work" });
  }

  // 8) Agency-style language in the description itself.
  if (job.description) {
    const m = AGENCY_TEXT.exec(job.description);
    if (m) {
      signals.push({ id: "agency_text", weight: 20, reason: `Agency-style language in description: "${m[0]}"` });
    }
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
