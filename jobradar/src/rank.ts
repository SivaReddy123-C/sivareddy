/**
 * Daily ranking: for every user profile, score open, country-matched,
 * non-ghost postings and upsert the top N into jr_user_job_matches.
 * Runs after sync in the daily Action, with the service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { GHOST_CUTOFF, scoreFit, type FitPosting, type FitProfile } from "./fit.js";
import { matchesCountry } from "./normalize.js";

interface ProfileRow {
  user_id: string;
  skills: string[] | null;
  countries: string[] | null;
  locations: string[] | null;
  seniority_target: string | null;
  daily_list_size: number | null;
}

interface PostingRow {
  id: string;
  title: string;
  location: string;
  country: string | null;
  description_text: string | null;
  has_salary: boolean;
  posted_at: string | null;
  first_seen_at: string;
  ghost_score: number | null;
  url: string;
}

async function fetchOpenPostings(db: SupabaseClient): Promise<PostingRow[]> {
  const rows: PostingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("jr_job_postings")
      .select("id, title, location, country, description_text, has_salary, posted_at, first_seen_at, ghost_score, url")
      .is("closed_at", null)
      .lt("ghost_score", 50)
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
    .select("user_id, skills, countries, locations, seniority_target, daily_list_size");
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
    };
    const listSize = Math.min(50, Math.max(5, p.daily_list_size ?? 30));

    const scored = postings
      .filter((post) => {
        if ((post.ghost_score ?? 0) >= GHOST_CUTOFF) return false;
        if (profile.countries.length === 0) return true;
        // Country column may be null on older rows - fall back to location text.
        const c = post.country?.toLowerCase();
        if (c) return profile.countries.includes(c);
        return profile.countries.some((cc) => matchesCountry(post.location, cc as "in" | "us"));
      })
      .map((post) => ({
        post,
        fit: scoreFit(profile, {
          title: post.title,
          location: post.location,
          country: post.country,
          descriptionText: post.description_text,
          hasSalary: post.has_salary,
          postedAt: post.posted_at,
          firstSeenAt: post.first_seen_at,
          ghostScore: post.ghost_score ?? 0,
        }, now),
      }))
      .sort((a, b) => b.fit.score - a.fit.score)
      .slice(0, listSize);

    const rows = scored.map((s, i) => ({
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
