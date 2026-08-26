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
  /** F-1/OPT/H-1B reality: when true, postings that state they cannot
   *  sponsor are excluded from the list entirely (passesHardFilters). */
  needsSponsorship: boolean;
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
  sponsorship: "no" | "yes" | "unknown";
}

export interface FitResult {
  score: number;
  reasons: string[];
}

const DAY = 24 * 60 * 60 * 1000;
export const GHOST_CUTOFF = 50;

const SENIORITY_ORDER = ["intern", "junior", "mid", "senior", "staff", "lead"];

/**
 * Skill terms that name the same technology. Bidirectional: a profile saying
 * "golang" matches a posting saying "Go" and vice versa.
 */
const SKILL_SYNONYMS: string[][] = [
  ["go", "golang"],
  ["node", "nodejs", "node.js"],
  ["js", "javascript"],
  ["ts", "typescript"],
  ["postgres", "postgresql"],
  ["c#", "csharp"],
  ["c++", "cpp"],
  ["k8s", "kubernetes"],
  ["react", "reactjs", "react.js"],
];
const SYNONYM_GROUP = new Map<string, string[]>();
for (const group of SKILL_SYNONYMS) for (const term of group) SYNONYM_GROUP.set(term, group);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does the text mention this skill AS A TOKEN?
 *
 * Naive substring matching made "go" match Google and category, "java" match
 * JavaScript, and forced a length guard that silently dropped C and R from
 * every profile. A token boundary here is any character that cannot be part
 * of a tech name ([a-z0-9+#.] are part; everything else separates), which
 * keeps "c++", "c#" and ".net" matchable while "java" no longer matches
 * "javascript" -- the 's' after it is a token character, so the boundary
 * fails. Synonyms expand both directions before matching.
 */
export function skillMentioned(haystack: string, skill: string): boolean {
  const terms = SYNONYM_GROUP.get(skill) ?? [skill];
  return terms.some((t) =>
    new RegExp(`(^|[^a-z0-9+#.])${escapeRe(t)}($|[^a-z0-9+#.])`).test(haystack),
  );
}

/**
 * Filters that are not scores. A posting that states it cannot sponsor is not
 * a WORSE match for a student who needs sponsorship -- it is not a match at
 * all, and showing it would cost them the exact hour this product exists to
 * save. "unknown" passes: most postings simply do not say, and excluding them
 * would empty every list.
 */
export function passesHardFilters(profile: FitProfile, posting: FitPosting): boolean {
  if (profile.needsSponsorship && posting.sponsorship === "no") return false;
  return true;
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

export function scoreFit(profile: FitProfile, posting: FitPosting, now = new Date()): FitResult {
  const reasons: string[] = [];
  let score = 0;

  // Skills: matched against title + description text.
  const haystack = `${posting.title} ${posting.descriptionText ?? ""}`.toLowerCase();
  const matched = profile.skills.filter((s) => s.length > 0 && skillMentioned(haystack, s));
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

  // Explicit sponsorship is rare enough in text that when an employer says
  // it, it is worth surfacing loudly to the people who need it.
  if (profile.needsSponsorship && posting.sponsorship === "yes") {
    score += 12;
    reasons.push("Explicitly offers visa sponsorship");
  }

  // Mild penalty for medium ghost risk (high/critical are filtered upstream).
  if (posting.ghostScore >= 25) {
    score -= Math.round((posting.ghostScore - 25) / 5);
    reasons.push(`Some ghost risk (score ${posting.ghostScore})`);
  }

  return { score, reasons };
}
