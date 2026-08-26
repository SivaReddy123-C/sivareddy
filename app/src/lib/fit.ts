/**
 * Deterministic fit scoring, mirrored from the pipeline (jobradar/src/fit.ts)
 * so the app can rank the public feed instantly in the browser. Keeping the
 * two in sync matters: the nightly job and the live list must agree.
 * No AI anywhere in this file - the same rules, the same reasons.
 */
import type { FeedJob } from "../jobs/feed.js";

export const GHOST_CUTOFF = 50;
const DAY = 24 * 60 * 60 * 1000;
const SENIORITY_ORDER = ["intern", "junior", "mid", "senior", "staff", "lead"];

export interface FitProfile {
  skills: string[];
  countries: string[];
  locations: string[];
  seniorityTarget: string | null;
  needsSponsorship: boolean;
}

export interface ScoredMatch {
  job: FeedJob;
  score: number;
  reasons: string[];
}

export function seniorityOfTitle(title: string): string | null {
  const t = title.toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return "intern";
  if (/junior|new grad|entry.level|early career|associate engineer|graduate/.test(t)) return "junior";
  if (/staff|principal|architect/.test(t)) return "staff";
  if (/\blead\b|manager|head of|director|vp\b/.test(t)) return "lead";
  if (/senior|sr\.?\s/.test(t)) return "senior";
  return null; // unstated usually means mid
}

export function scoreFit(profile: FitProfile, job: FeedJob, now = new Date()): ScoredMatch {
  const reasons: string[] = [];
  let score = 0;

  // Feed jobs carry no description, so skills match against the title only -
  // stricter than the nightly job, which is honest rather than generous.
  const haystack = job.title.toLowerCase();
  const matched = profile.skills.filter((s) => s.length >= 2 && haystack.includes(s));
  if (matched.length > 0) {
    score += Math.min(45, matched.length * 15);
    reasons.push(`Matches your skills: ${matched.slice(0, 5).join(", ")}`);
  }

  const loc = job.location.toLowerCase();
  const locHit = profile.locations.find((l) => l.length >= 3 && loc.includes(l));
  if (locHit) {
    score += 10;
    reasons.push(`In your preferred location (${locHit})`);
  }

  if (profile.seniorityTarget) {
    const target = SENIORITY_ORDER.indexOf(profile.seniorityTarget);
    const posted = SENIORITY_ORDER.indexOf(seniorityOfTitle(job.title) ?? "mid");
    if (target >= 0 && posted >= 0) {
      const gap = Math.abs(target - posted);
      if (gap === 0) {
        score += 15;
        reasons.push("Seniority level matches your target");
      } else if (gap >= 2) {
        score -= 15;
        reasons.push(`Seniority looks ${posted > target ? "above" : "below"} your target`);
      }
    }
  }

  const posted = job.publishedAt ?? job.firstSeenAt;
  const days = Math.floor((now.getTime() - new Date(posted).getTime()) / DAY);
  if (days <= 7) {
    score += 15;
    reasons.push(`Fresh - posted ${days}d ago`);
  } else if (days <= 14) {
    score += 8;
    reasons.push(`Posted ${days}d ago`);
  }

  if (job.hasSalaryInfo) {
    score += 5;
    reasons.push("Salary stated");
  }
  if (job.sponsorship === "yes") {
    score += 10;
    reasons.push("States it sponsors visas");
  }

  if (job.ghost.score >= 25) {
    score -= Math.round((job.ghost.score - 25) / 5);
    reasons.push(`Some ghost risk (score ${job.ghost.score})`);
  }

  return { job, score, reasons };
}

/**
 * Rank the whole feed for one profile. Ghosts are excluded, never ranked down.
 * At most `maxPerCompany` roles from any one employer reach the list: without
 * that cap a board with thousands of postings (Bosch has ~4,800) crowds out
 * every other company, which is useless to the person reading it.
 */
export function rankFeed(
  jobs: FeedJob[],
  profile: FitProfile,
  limit: number,
  now = new Date(),
  maxPerCompany = 3,
): ScoredMatch[] {
  const ranked = jobs
    .filter((j) => {
      if (j.ghost.score >= GHOST_CUTOFF) return false;
      if (profile.needsSponsorship && j.sponsorship === "no") return false;
      if (profile.countries.length > 0 && !profile.countries.includes(j.country)) return false;
      return true;
    })
    .map((j) => scoreFit(profile, j, now))
    .sort((a, b) => b.score - a.score);

  const perCompany = new Map<string, number>();
  const out: ScoredMatch[] = [];
  for (const m of ranked) {
    if (out.length >= limit) break;
    const seen = perCompany.get(m.job.company) ?? 0;
    if (seen >= maxPerCompany) continue;
    perCompany.set(m.job.company, seen + 1);
    out.push(m);
  }
  return out;
}

/** Skills and locations a resume already states - used to prefill the profile. */
export function profileFromResume(resume: {
  skills: { items: string }[];
  basics: { location: string };
}): { skills: string[]; locations: string[] } {
  const skills = resume.skills
    .flatMap((g) => g.items.split(","))
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2);
  const locations = resume.basics.location
    .split(/[·,;|]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3 && !/^open to/.test(s));
  return { skills: [...new Set(skills)], locations: [...new Set(locations)] };
}
