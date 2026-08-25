/**
 * Free, offline writing feedback. Rule-based, no AI, no network, no key -
 * every user gets this instantly. Heuristics, stated as hints, never blockers.
 */

const WEAK_OPENERS = [
  "responsible for", "worked on", "helped with", "helped to", "assisted with",
  "involved in", "participated in", "was part of", "tasked with", "duties included",
];

const ACTION_VERB_HINT =
  /^(built|created|designed|developed|shipped|led|launched|reduced|increased|improved|automated|migrated|implemented|optimized|wrote|architected|delivered|debugged|deployed|integrated|refactored|scaled|tested|maintained|analyzed|presented|mentored|won|founded|published|contributed)/i;

export function checkBullet(text: string): string[] {
  const hints: string[] = [];
  const t = text.trim();
  if (!t) return hints;
  const lower = t.toLowerCase();

  for (const weak of WEAK_OPENERS) {
    if (lower.startsWith(weak)) {
      hints.push(`Starts with "${weak}" — lead with what you did: "Built...", "Reduced...", "Shipped..."`);
      break;
    }
  }
  if (hints.length === 0 && !ACTION_VERB_HINT.test(t)) {
    hints.push("Consider starting with a strong action verb (Built, Led, Reduced...)");
  }
  if (!/\d/.test(t)) {
    hints.push("No number — impact with a metric (%, time saved, users, ₹/$) is far more convincing");
  }
  if (t.length > 220) {
    hints.push("Long for one bullet — split it or trim to the core achievement");
  }
  return hints;
}

export function checkSummary(text: string): string[] {
  const hints: string[] = [];
  const t = text.trim();
  if (!t) return hints;
  if (t.length < 60) hints.push("Very short — two or three concrete lines beat one vague one");
  if (t.length > 450) hints.push("Long — recruiters skim; aim for 2-3 tight lines");
  if (/passionate|hardworking|motivated|dynamic|team player|detail-oriented/i.test(t)) {
    hints.push("Generic adjectives (passionate, motivated...) carry no information — show, don't claim");
  }
  return hints;
}
