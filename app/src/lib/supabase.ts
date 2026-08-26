/**
 * Supabase client for the account layer ("For you" matches, cloud profile,
 * outcome events). Everything else in the app stays local-first - an account
 * is optional and only powers the personalized daily list.
 * The anon (publishable) key is safe to ship: RLS restricts it to public job
 * data plus the signed-in user's own rows.
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://udvhqvdydkcqxkdzsdbg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_GFd4l0RNHuGqw76S2juM7w_-cQHhPFs";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

export type { Session };

export interface ProfileRecord {
  user_id: string;
  full_name: string | null;
  headline: string | null;
  countries: string[];
  locations: string[];
  skills: string[];
  seniority_target: string | null;
  daily_list_size: number;
  /** When true, ranking excludes postings that state they cannot sponsor. */
  needs_sponsorship: boolean;
}

export interface MatchRecord {
  id: string;
  match_date: string;
  rank: number;
  fit_score: number;
  fit_reasons: string[];
  ghost_score_at_match: number | null;
  status: "suggested" | "viewed" | "dismissed" | "applied";
  jr_job_postings: {
    id: string;
    title: string;
    location: string;
    url: string;
    apply_url: string | null;
    has_salary: boolean;
    sponsorship: string;
    posted_at: string | null;
    first_seen_at: string;
    ghost_reasons: string[] | null;
    jr_companies: { name: string } | null;
  } | null;
}

/** Latest day's matches for the signed-in user, joined to postings. */
export async function fetchMatches(): Promise<MatchRecord[]> {
  const db = supabase();
  const { data: latest, error: dErr } = await db
    .from("jr_user_job_matches")
    .select("match_date")
    .order("match_date", { ascending: false })
    .limit(1);
  if (dErr) throw new Error(dErr.message);
  const day = latest?.[0]?.match_date;
  if (!day) return [];
  const { data, error } = await db
    .from("jr_user_job_matches")
    .select("id, match_date, rank, fit_score, fit_reasons, ghost_score_at_match, status, jr_job_postings(id, title, location, url, apply_url, has_salary, sponsorship, posted_at, first_seen_at, ghost_reasons, jr_companies(name))")
    .eq("match_date", day)
    .order("rank", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MatchRecord[];
}

export async function setMatchStatus(id: string, status: MatchRecord["status"]): Promise<void> {
  const { error } = await supabase().from("jr_user_job_matches").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function logApplicationEvent(userId: string, posting: NonNullable<MatchRecord["jr_job_postings"]>): Promise<void> {
  const { error } = await supabase().from("jr_application_events").insert({
    user_id: userId,
    posting_id: posting.id,
    company_name: posting.jr_companies?.name ?? null,
    title: posting.title,
    url: posting.url,
    event: "applied",
    source: "jobradar",
  });
  if (error) throw new Error(error.message);
}
