/**
 * Daily ranking: for every user profile, score open, country-matched,
 * non-ghost postings and upsert the top N into jr_user_job_matches.
 * Runs after sync in the daily Action, with the service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { GHOST_CUTOFF, passesHardFilters, scoreFit, type FitPosting, type FitProfile } from "./fit.js";
import { detectCountry } from "./normalize.js";

/** One employer may not occupy more than this many slots in a daily list. */
const MAX_PER_COMPANY = 3;

interface ProfileRow {
  user_id: string;
  skills: string[] | null;
  countries: string[] | null;
  locations: string[] | null;
  seniority_target: string | null;
  daily_list_size: number | null;
  needs_sponsorship: boolean | null;
}

interface PostingRow {
  id: string;
  company_id: string;
  title: string;
  location: string;
  country: string | null;
  description_text: string | null;
  has_salary: boolean;
  posted_at: string | null;
  first_seen_at: string;
  ghost_score: number | null;
  sponsorship: "no" | "yes" | "unknown" | null;
  url: string;
}

async function fetchOpenPostings(db: SupabaseClient): Promise<PostingRow[]> {
  const rows: PostingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("jr_job_postings")
      .select("id, title, location, country, description_text, has_salary, posted_at, first_seen_at, ghost_score, sponsorship, url")
      .is("closed_at", null)
      .lt("ghost_score", 50)
      // Unordered .range() pagination has no stable page boundaries -- rows
      // can repeat or vanish between requests. Order by primary key.
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`posting fetch failed: ${error.message}`);
    rows.push(...((data ?? []) as PostingRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function rankAllUsers(db: SupabaseClient, now = new Date()): Promise<{ users: number; matches: number }> {
  const { data: profiles, error: pErr } = await db
    .from("jr_user_profiles")
    .select("user_id, skills, countries, locations, seniority_target, daily_list_size, needs_sponsorship");
  if (pErr) throw new Error(`profile fetch failed: ${pErr.message}`);
  if (!profiles || profiles.length === 0) return { users: 0, matches: 0 };

  const postings = await fetchOpenPostings(db);
  const matchDate = now.toISOString().slice(0, 10);
  let total = 0;

  for (const p of profiles as ProfileRow[]) {
    const profile: FitProfile = {
      skills: (p.skills ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean),
      countries: (p.countries ?? []).map((c) => c.toLowerCase()),
      locations: (p.locations ?? []).map((l) => l.toLowerCase().trim()).filter(Boolean),
      seniorityTarget: p.seniority_target,
      needsSponsorship: Boolean(p.needs_sponsorship),
    };
    const listSize = Math.min(50, Math.max(5, p.daily_list_size ?? 30));

    const scored = postings
      .filter((post) => {
        if ((post.ghost_score ?? 0) >= GHOST_CUTOFF) return false;
        if (!passesHardFilters(profile, toFitPosting(post))) return false;
        if (profile.countries.length === 0) return true;
        // Country column may be null on older rows - fall back to location text.
        const c = post.country?.toLowerCase() ?? detectCountry(post.location);
        return c !== null && profile.countries.includes(c);
      })
      .map((post) => ({
        post,
        fit: scoreFit(profile, toFitPosting(post), now),
      }))
      .sort((a, b) => b.fit.score - a.fit.score);

    // Cap per employer for the same reason the live ranker does: one huge
    // board would otherwise be the entire list.
    const perCompany = new Map<string, number>();
    const capped: typeof scored = [];
    for (const s of scored) {
      if (capped.length >= listSize) break;
      const seen = perCompany.get(s.post.company_id) ?? 0;
      if (seen >= MAX_PER_COMPANY) continue;
      perCompany.set(s.post.company_id, seen + 1);
      capped.push(s);
    }

    const rows = capped.map((s, i) => ({
      user_id: p.user_id,
      posting_id: s.post.id,
      match_date: matchDate,
      rank: i + 1,
      fit_score: s.fit.score,
      fit_reasons: s.fit.reasons,
      ghost_score_at_match: s.post.ghost_score,
    }));
    if (rows.length > 0) {
      const { error } = await db
        .from("jr_user_job_matches")
        .upsert(rows, { onConflict: "user_id,posting_id,match_date" });
      if (error) throw new Error(`match upsert failed for ${p.user_id}: ${error.message}`);
      total += rows.length;
    }
  }
  return { users: profiles.length, matches: total };
}

function toFitPosting(post: PostingRow): FitPosting {
  return {
    title: post.title,
    location: post.location,
    country: post.country,
    descriptionText: post.description_text,
    hasSalary: post.has_salary,
    postedAt: post.posted_at,
    firstSeenAt: post.first_seen_at,
    ghostScore: post.ghost_score ?? 0,
    sponsorship: post.sponsorship ?? "unknown",
  };
}
