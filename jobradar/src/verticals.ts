/**
 * Which companies ARE a vertical, as opposed to selling into one.
 *
 * Text matching cannot tell these apart and it produced a bad list: an AI
 * customer-service company had fifteen postings tagged hospitality - payroll
 * manager, office manager, compensation lead - because every posting names the
 * industries it serves. Meanwhile a hotel revenue-management company's
 * engineering roles are genuinely hospitality jobs and say so nowhere in the
 * title.
 *
 * The difference is a fact about the employer, not about the words in one
 * posting, so it is recorded per employer, by hand, from the same curated list
 * the boards were seeded from. Deterministic and checkable: if a name is here,
 * someone put it here on purpose.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

let cache: Map<string, string> | null = null;

function load(): Map<string, string> {
  if (cache) return cache;
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "verticals.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, string[]>;
  cache = new Map();
  for (const [vertical, companies] of Object.entries(raw)) {
    for (const c of companies) cache.set(norm(c), vertical);
  }
  return cache;
}

/** The vertical this employer operates in, or null when it is not one we track. */
export function industryOf(company: string): string | null {
  return load().get(norm(company)) ?? null;
}

/** Test seam: build a lookup from an explicit map rather than the data file. */
export function industryFrom(raw: Record<string, string[]>, company: string): string | null {
  for (const [vertical, companies] of Object.entries(raw)) {
    if (companies.some((c) => norm(c) === norm(company))) return vertical;
  }
  return null;
}
