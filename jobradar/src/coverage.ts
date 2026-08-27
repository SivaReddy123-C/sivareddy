/**
 * Coverage: what each user is looking for, against what we actually track.
 *
 * This exists because of a failure that took a user to notice. Siva's whole
 * background is hotel operations and hotel software; the feed carried about
 * twenty-five hospitality postings out of thirty-three thousand, and nothing
 * in the system said so. He had to work it out and tell us.
 *
 * A search product that cannot say "you are asking for something we barely
 * have" is not being honest with the person relying on it. This turns that
 * into a number that shows up in every run, before anyone has to complain.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Gap {
  skill: string;
  postings: number;
  /** Of those, how many are in a country the user will actually take. */
  inTargetCountries: number;
}

export interface CoverageReport {
  userId: string;
  totalPostings: number;
  gaps: Gap[];
  covered: Gap[];
}

/** Below this, a skill is not really served by our inventory. */
export const THIN = 50;

export function assess(
  skills: string[],
  countries: string[],
  postings: { tags: string[]; title: string; country: string | null }[],
): { gaps: Gap[]; covered: Gap[] } {
  const gaps: Gap[] = [];
  const covered: Gap[] = [];

  for (const skill of skills) {
    const needle = skill.toLowerCase().trim();
    if (!needle) continue;
    let total = 0, inTarget = 0;
    for (const p of postings) {
      const hit = p.tags.includes(needle) || p.title.toLowerCase().includes(needle);
      if (!hit) continue;
      total++;
      if (countries.length === 0 || (p.country && countries.includes(p.country))) inTarget++;
    }
    const row: Gap = { skill: needle, postings: total, inTargetCountries: inTarget };
    (inTarget < THIN ? gaps : covered).push(row);
  }
  gaps.sort((a, b) => a.inTargetCountries - b.inTargetCountries);
  covered.sort((a, b) => b.inTargetCountries - a.inTargetCountries);
  return { gaps, covered };
}

export async function coverage(
  db: SupabaseClient,
  feed: { jobs: { tags?: string[]; title: string; country: string | null }[] },
): Promise<CoverageReport[]> {
  const { data: profiles, error } = await db
    .from("jr_user_profiles").select("user_id, skills, countries");
  if (error) throw new Error(`profile fetch failed: ${error.message}`);

  const postings = feed.jobs.map((j) => ({
    tags: (j.tags ?? []).map((t) => t.toLowerCase()),
    title: j.title,
    country: j.country,
  }));

  return (profiles ?? []).map((p) => {
    const r = p as { user_id: string; skills: string[] | null; countries: string[] | null };
    const { gaps, covered } = assess(r.skills ?? [], r.countries ?? [], postings);
    return { userId: r.user_id, totalPostings: postings.length, gaps, covered };
  });
}

/**
 * Where the work this user wants actually is.
 *
 * The skill report says "hospitality is thin for you". It does not say the
 * thing that would help: there are 1,428 hospitality jobs in the feed and 71
 * of them are in your four countries, because hospitality technology hires in
 * the US, Thailand, the UK and Germany. Knowing a gap exists is useless
 * without knowing where it closes.
 */
export function countriesFor(
  skills: string[],
  targetCountries: string[],
  postings: { tags: string[]; title: string; country: string | null }[],
): { country: string; postings: number; targeted: boolean }[] {
  const needles = skills.map((s) => s.toLowerCase().trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const p of postings) {
    if (!p.country) continue;
    const hit = needles.some((n) => p.tags.includes(n) || p.title.toLowerCase().includes(n));
    if (!hit) continue;
    counts.set(p.country, (counts.get(p.country) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([country, n]) => ({ country, postings: n, targeted: targetCountries.includes(country) }))
    .sort((a, b) => b.postings - a.postings);
}

/** One user's report, as a line-per-gap block for the run log. */
export function format(r: CoverageReport, countries: ReturnType<typeof countriesFor> = []): string {
  const lines = [`coverage for ${r.userId.slice(0, 8)}: ${r.covered.length} skills served, ${r.gaps.length} thin`];
  for (const g of r.gaps.slice(0, 12)) {
    lines.push(`  THIN  ${g.skill.padEnd(24)} ${String(g.inTargetCountries).padStart(5)} in target countries (${g.postings} total)`);
  }
  const missed = countries.filter((c) => !c.targeted).slice(0, 6);
  if (missed.length > 0) {
    const reachable = countries.filter((c) => c.targeted).reduce((a, c) => a + c.postings, 0);
    lines.push(`  reachable in the countries on this profile: ${reachable}`);
    lines.push(`  most of this work is elsewhere: ${missed.map((c) => `${c.country} ${c.postings}`).join(", ")}`);
  }
  return lines.join("\n");
}
