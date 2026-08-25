/**
 * Deterministic fit scoring: profile + posting -> score + human-readable
 * reasons. No LLM anywhere in this file, by design. Ghost filtering happens
 * before ranking: postings scoring ghost >= 50 never enter a user's list.
 */

export interface FitProfile {
  skills: string[];        // lowercase
  countries: string[];     // "in" | "us"
  locations: string[];     // lowercase substrings ("bengaluru", "remote")
  seniorityTarget: string | null; // intern|junior|mid|senior|staff|lead
}

export interface FitPosting {
  title: string;
  location: string;
  country: string | null;
  descriptionText: string | null;
  hasSalary: boolean;
  postedAt: string | null;
  firstSeenAt: string;
  ghostScore: number;
}

export interface FitResult {
  score: number;
  reasons: string[];
}

const DAY = 24 * 60 * 60 * 1000;
export const GHOST_CUTOFF = 50;

const SENIORITY_ORDER = ["intern", "junior", "mid", "senior", "staff", "lead"];

export function seniorityOfTitle(title: string): string | null {
  const t = title.toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return "intern";
  if (/junior|new grad|entry.level|early career|associate engineer|graduate/.test(t)) return "junior";
  if (/staff|principal|architect/.test(t)) return "staff";
  if (/\blead\b|manager|head of|director|vp\b/.test(t)) return "lead";
  if (/senior|sr\.?\s/.test(t)) return "senior";
  return null; // unstated usually means mid
}

export function scoreFit(profile: FitProfile, posting: FitPosting, now = new Date()): FitResult {
  const reasons: string[] = [];
  let score = 0;

  // Skills: matched against title + description text.
  const haystack = `${posting.title} ${posting.descriptionText ?? ""}`.toLowerCase();
  const matched = profile.skills.filter((s) => s.length >= 2 && haystack.includes(s));
  if (matched.length > 0) {
    score += Math.min(45, matched.length * 15);
    reasons.push(`Matches your skills: ${matched.slice(0, 5).join(", ")}`);
  }

  // Location: profile substrings against posting location; "remote" counts.
  const loc = posting.location.toLowerCase();
  const locHit = profile.locations.find((l) => l.length >= 3 && loc.includes(l));
  if (locHit) {
    score += 10;
    reasons.push(`In your preferred location (${locHit})`);
  }

  // Seniority: distance on the ladder. Unstated title = mid.
  if (profile.seniorityTarget) {
    const target = SENIORITY_ORDER.indexOf(profile.seniorityTarget);
    const posted = SENIORITY_ORDER.indexOf(seniorityOfTitle(posting.title) ?? "mid");
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

  // Freshness: the strongest predictor of a real, reachable opening.
  const posted = posting.postedAt ?? posting.firstSeenAt;
  const days = Math.floor((now.getTime() - new Date(posted).getTime()) / DAY);
  if (days <= 7) {
    score += 15;
    reasons.push(`Fresh - posted ${days}d ago`);
  } else if (days <= 14) {
    score += 8;
    reasons.push(`Posted ${days}d ago`);
  }

  if (posting.hasSalary) {
    score += 5;
    reasons.push("Salary stated");
  }

  // Mild penalty for medium ghost risk (high/critical are filtered upstream).
  if (posting.ghostScore >= 25) {
    score -= Math.round((posting.ghostScore - 25) / 5);
    reasons.push(`Some ghost risk (score ${posting.ghostScore})`);
  }

  return { score, reasons };
}
