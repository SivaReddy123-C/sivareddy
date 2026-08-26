/**
 * Daily digest: each opted-in user's ranked list, delivered — so the session
 * can end before it starts. A student who reads five vetted matches over
 * breakfast and closes the mail has done the day's job search.
 *
 * Principles applied:
 *   - OPT-IN only (jr_user_profiles.daily_email, default false). "Never
 *     nagged" is a README rule; the inbox is entered by invitation.
 *   - An empty list sends NOTHING. A daily "no jobs today" email is spam
 *     wearing a helpful face.
 *   - The email exists to END the session: matches, reasons, links, done.
 *     No engagement hooks, no "browse more", no unread-count bait.
 *
 * Sending uses Resend's plain HTTPS API, gated on RESEND_API_KEY — absent
 * key, the step logs and exits 0, exactly like sync without Supabase.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DigestMatch {
  rank: number;
  title: string;
  company: string;
  location: string;
  url: string;
  sponsorship: "no" | "yes" | "unknown";
  fitReasons: string[];
}

export function composeDigest(matches: DigestMatch[], dateIso: string): { subject: string; text: string; html: string } {
  const n = matches.length;
  const subject = `Your ${n} vetted match${n === 1 ? "" : "es"} today — then go study`;
  const line = (m: DigestMatch) => {
    const sponsor = m.sponsorship === "yes" ? " · sponsors visas" : "";
    return `${m.rank}. ${m.title} — ${m.company} (${m.location || "location unlisted"})${sponsor}\n   ${m.fitReasons.slice(0, 2).join("; ")}\n   ${m.url}`;
  };
  const text = [
    `Ghost-filtered, ranked for your profile, ${dateIso}.`,
    "",
    ...matches.map(line),
    "",
    "That's the whole list. Apply to what fits, skip what doesn't, and spend the rest of the day learning — that's the point.",
    "",
    "Turn this email off any time in your JobRadar profile.",
  ].join("\n");

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const item = (m: DigestMatch) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #eee">
      <a href="${esc(m.url)}" style="font-size:15px;font-weight:600;color:#1a56db;text-decoration:none">${m.rank}. ${esc(m.title)}</a>
      <div style="font-size:13px;color:#374151">${esc(m.company)} · ${esc(m.location || "location unlisted")}${m.sponsorship === "yes" ? ' · <strong style="color:#047857">sponsors visas</strong>' : ""}</div>
      <div style="font-size:12px;color:#6b7280">${esc(m.fitReasons.slice(0, 2).join("; "))}</div>
    </td></tr>`;
  const html = `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:16px">
    <p style="font-size:13px;color:#6b7280;margin:0 0 4px">Ghost-filtered, ranked for your profile · ${esc(dateIso)}</p>
    <table style="width:100%;border-collapse:collapse">${matches.map(item).join("")}</table>
    <p style="font-size:13px;color:#374151;margin:16px 0 4px">That's the whole list. Apply to what fits, skip what doesn't, and spend the rest of the day learning — that's the point.</p>
    <p style="font-size:11px;color:#9ca3af;margin:12px 0 0">Turn this email off any time in your JobRadar profile.</p>
  </div>`;
  return { subject, text, html };
}

interface ProfileRow { user_id: string }
interface MatchRow {
  user_id: string; posting_id: string; rank: number; fit_reasons: string[] | null;
}
interface PostingRow {
  id: string; title: string; location: string; url: string;
  sponsorship: "no" | "yes" | "unknown" | null; company_id: string;
}

export async function sendDigests(db: SupabaseClient, now = new Date()): Promise<{ sent: number; skipped: number }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DIGEST_FROM || "JobRadar <onboarding@resend.dev>";
  if (!apiKey) {
    console.log("digest: RESEND_API_KEY not set — skipping (nothing sent, not an error)");
    return { sent: 0, skipped: 0 };
  }
  const matchDate = now.toISOString().slice(0, 10);

  const { data: profiles, error: pErr } = await db
    .from("jr_user_profiles").select("user_id").eq("daily_email", true);
  if (pErr) throw new Error(`digest profile fetch failed: ${pErr.message}`);
  if (!profiles || profiles.length === 0) return { sent: 0, skipped: 0 };

  const userIds = (profiles as ProfileRow[]).map((p) => p.user_id);
  const { data: matches, error: mErr } = await db
    .from("jr_user_job_matches")
    .select("user_id, posting_id, rank, fit_reasons")
    .eq("match_date", matchDate)
    .in("user_id", userIds)
    .order("rank");
  if (mErr) throw new Error(`digest match fetch failed: ${mErr.message}`);

  const postingIds = [...new Set(((matches ?? []) as MatchRow[]).map((m) => m.posting_id))];
  const postingsById = new Map<string, PostingRow>();
  for (let i = 0; i < postingIds.length; i += 200) {
    const { data, error } = await db
      .from("jr_job_postings")
      .select("id, title, location, url, sponsorship, company_id")
      .in("id", postingIds.slice(i, i + 200));
    if (error) throw new Error(`digest posting fetch failed: ${error.message}`);
    for (const r of (data ?? []) as PostingRow[]) postingsById.set(r.id, r);
  }
  const companyIds = [...new Set([...postingsById.values()].map((p) => p.company_id))];
  const companyName = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data, error } = await db.from("jr_companies").select("id, name").in("id", companyIds);
    if (error) throw new Error(`digest company fetch failed: ${error.message}`);
    for (const c of (data ?? []) as { id: string; name: string }[]) companyName.set(c.id, c.name);
  }

  let sent = 0, skipped = 0;
  for (const userId of userIds) {
    const mine = ((matches ?? []) as MatchRow[]).filter((m) => m.user_id === userId);
    // An empty list sends nothing — "no jobs today, every day" is spam.
    if (mine.length === 0) { skipped++; continue; }

    const { data: userRes, error: uErr } = await db.auth.admin.getUserById(userId);
    const email = userRes?.user?.email;
    if (uErr || !email) { skipped++; continue; }

    const digestMatches: DigestMatch[] = mine
      .map((m) => {
        const post = postingsById.get(m.posting_id);
        if (!post) return null;
        return {
          rank: m.rank,
          title: post.title,
          company: companyName.get(post.company_id) ?? "",
          location: post.location,
          url: post.url,
          sponsorship: post.sponsorship ?? "unknown",
          fitReasons: m.fit_reasons ?? [],
        };
      })
      .filter((x): x is DigestMatch => x !== null);
    if (digestMatches.length === 0) { skipped++; continue; }

    const { subject, text, html } = composeDigest(digestMatches, matchDate);
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: email, subject, text, html }),
    });
    if (!resp.ok) {
      // One bad address must not kill the batch.
      console.error(`digest: send failed for ${userId}: ${resp.status} ${await resp.text().catch(() => "")}`);
      skipped++;
      continue;
    }
    sent++;
  }
  return { sent, skipped };
}
