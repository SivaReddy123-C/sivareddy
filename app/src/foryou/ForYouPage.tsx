import { useEffect, useMemo, useState } from "react";
import { daysSince } from "../lib/stats.js";
import { uid } from "../lib/storage.js";
import { buildApplicationPack } from "../lib/pack.js";
import { profileFromResume, rankFeed, type ScoredMatch } from "../lib/fit.js";
import { loadFeed, loadFeedSWR, type Feed } from "../jobs/feed.js";
import { SponsorBadge } from "../jobs/SponsorBadge.js";
import type { AnswerEntry, Application, ResumeData } from "../lib/types.js";
import { uid as newId } from "../lib/storage.js";
import { COUNTRY_LABELS } from "../jobs/feed.js";
import {
  fetchMatches, logApplicationEvent, setMatchStatus, supabase,
  type MatchRecord, type ProfileRecord, type Session,
} from "../lib/supabase.js";

interface Props {
  applications: Application[];
  onChange: (apps: Application[]) => void;
  resume: ResumeData;
  answers: AnswerEntry[];
}

/** Account-backed personalized daily list. Everything else stays local-first. */
export function ForYouPage({ applications, onChange, resume, answers }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const db = supabase();
    db.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = db.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="foryou"><p className="jobs-meta">Loading…</p></div>;
  if (!session) return <AuthForm />;
  return <SignedIn session={session} applications={applications} onChange={onChange} resume={resume} answers={answers} />;
}

function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg("");
    const db = supabase();
    try {
      if (mode === "signup") {
        const { data, error } = await db.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.href },
        });
        if (error) throw error;
        if (!data.session) setMsg("Check your email to confirm your account, then sign in here.");
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="foryou">
      <div className="card auth-card">
        <h3>{mode === "signin" ? "Sign in" : "Create your account"}</h3>
        <p className="hint">
          An account powers exactly one thing: your personalized daily list, ranked from the
          scored jobs feed. Your resume and tracker stay in your browser either way.
        </p>
        <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Password (8+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="primary" disabled={busy || !email || password.length < 8} onClick={submit}>
          {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
        {msg && <p className="ai-error">{msg}</p>}
      </div>
    </div>
  );
}

function SignedIn({ session, applications, onChange, resume, answers }: Props & { session: Session }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [feedError, setFeedError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("jobradar.dismissed") ?? "[]"); } catch { return []; }
  });

  async function copyPack(id: string) {
    await navigator.clipboard.writeText(buildApplicationPack(resume, answers));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  useEffect(() => {
    void (async () => {
      try {
        const db = supabase();
        // The profile decides which country shards to fetch, so it has to come
        // first. Fetching every country was the old behaviour and it meant
        // downloading 24 MB to look at jobs in one place.
        const { data, error: pErr } = await db
          .from("jr_user_profiles").select("*").eq("user_id", session.user.id).maybeSingle();
        if (pErr) throw pErr;
        if (data) setProfile(data as ProfileRecord);
        else setEditing(true);

        const countries = ((data as ProfileRecord | null)?.countries ?? []).filter(Boolean);
        // Paint from cache at once, then swap in a newer feed when it lands.
        const cachedFeed = loadFeedSWR(setFeed, countries);
        if (cachedFeed) setFeed(cachedFeed);
        else {
          // A feed that failed to load is not an empty result. Telling someone
          // "no matches for this profile" when the data never arrived sends
          // them off to rewrite a profile that was never the problem.
          try {
            setFeed(await loadFeed(false, countries));
          } catch (err) {
            setFeedError((err as Error).message || "Could not load the jobs feed");
          }
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [session.user.id]);

  async function saveProfile(p: Omit<ProfileRecord, "user_id">) {
    setError("");
    try {
      const record = { ...p, user_id: session.user.id, updated_at: new Date().toISOString() };
      const { error: uErr } = await supabase().from("jr_user_profiles").upsert(record);
      if (uErr) throw uErr;
      setProfile({ ...p, user_id: session.user.id });
      setEditing(false); // list below re-ranks immediately - no waiting for the nightly job
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // The list is computed here, in the browser, from the public feed and the
  // current profile - so editing the profile changes the list instantly. The
  // nightly job still writes matches for the email digest.
  const matches: ScoredMatch[] = useMemo(() => {
    if (!feed || !profile) return [];
    return rankFeed(feed.jobs, {
      skills: (profile.skills ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean),
      countries: profile.countries ?? [],
      locations: (profile.locations ?? []).map((l) => l.toLowerCase().trim()).filter(Boolean),
      seniorityTarget: profile.seniority_target,
      needsSponsorship: Boolean((profile as { needs_sponsorship?: boolean }).needs_sponsorship),
    }, profile.daily_list_size ?? 30).filter((m) => !dismissed.includes(m.job.key));
  }, [feed, profile, dismissed]);

  const appliedUrls = useMemo(
    () => new Set(applications.map((a) => a.url).filter(Boolean)),
    [applications],
  );

  async function markApplied(m: ScoredMatch) {
    const now = new Date().toISOString();
    onChange([
      {
        id: newId(), company: m.job.company, title: m.job.title,
        url: m.job.url, location: m.job.location, source: "jobradar",
        appliedAt: now, status: "applied", statusChangedAt: now, notes: "",
      },
      ...applications,
    ]);
    try {
      await supabase().from("jr_application_events").insert({
        user_id: session.user.id, posting_id: null,
        company_name: m.job.company, title: m.job.title, url: m.job.url,
        event: "applied", source: "jobradar",
      });
    } catch {
      // The local tracker entry stands even if the cloud write hiccups.
    }
  }

  function dismiss(m: ScoredMatch) {
    const next = [...dismissed, m.job.key];
    setDismissed(next);
    try { localStorage.setItem("jobradar.dismissed", JSON.stringify(next)); } catch { /* ignore */ }
  }

  return (
    <div className="foryou">
      <div className="foryou-head">
        <span className="jobs-meta">Signed in as {session.user.email}</span>
        <button onClick={() => setEditing((v) => !v)}>{editing ? "Close profile" : "Edit profile"}</button>
        <button onClick={() => supabase().auth.signOut()}>Sign out</button>
      </div>
      {error && <p className="jobs-error">{error}</p>}

      {editing && <ProfileEditor initial={profile} resume={resume} onSave={saveProfile} />}

      {!editing && loading && <p className="jobs-meta">Loading your matches…</p>}

      {!editing && !loading && feedError && (
        <p className="empty-hint">
          Couldn't load the jobs feed, so there is nothing to match against yet — this is not a
          problem with your profile. <strong>{feedError}</strong> The feed is republished by the
          daily run; try again shortly, or press Refresh.
        </p>
      )}

      {!editing && !loading && !feedError && profile && matches.length === 0 && (
        <p className="empty-hint">
          No matches for this profile. Every match must genuinely involve one of your skills — we
          won't pad the list with nearby, recent, senior-sounding roles that have nothing to do with
          your work. Add more skills (both tools and role words: <em>python, aws, backend, data
          engineer, full stack</em>), add countries, or raise your list size. The list updates the
          moment you save.
        </p>
      )}

      {!editing && !loading && matches.length > 0 && (
        <>
          <p className="jobs-meta">
            Your top {matches.length} matches, ranked live against your profile from
            {" "}{feed?.total.toLocaleString()} scored postings from {feed?.generatedAt.slice(0, 10)} ·
            ghosts (score ≥50) excluded · every match involves one of your skills · edit your
            profile and this list changes immediately
          </p>
          <div className="job-list">
            {matches.map((m, i) => {
              const applied = appliedUrls.has(m.job.url);
              const posted = m.job.publishedAt ?? m.job.firstSeenAt;
              return (
                <div className="card job-card" key={m.job.key}>
                  <div className="job-main">
                    <div className="job-title">
                      <span className="rank-chip">#{i + 1}</span>{" "}
                      <strong>{m.job.company}</strong> · {m.job.title}
                    </div>
                    <div className="job-meta">
                      {m.job.location} · posted {daysSince(posted)}d ago
                      {m.job.hasSalaryInfo && <span className="tag tag-salary">salary stated</span>}
                      {m.job.sponsorship === "yes" && <span className="tag tag-sponsor">sponsors visa</span>}
                      {m.job.sponsorship === "no" && <span className="tag tag-nosponsor">won't sponsor</span>}
                      <SponsorBadge job={m.job} />
                      <span className="tag">fit {m.score}</span>
                      <span className="tag">ghost {m.job.ghost.score}</span>
                    </div>
                    <ul className="fit-reasons">
                      {m.reasons.map((r, k) => <li key={k}>{r}</li>)}
                    </ul>
                  </div>
                  <div className="job-actions">
                    <a className="btn-link" href={m.job.url} target="_blank" rel="noreferrer">Open posting ↗</a>
                    <button onClick={() => copyPack(m.job.key)}>{copiedId === m.job.key ? "Copied ✓" : "Copy pack"}</button>
                    {applied ? (
                      <span className="applied-mark">Applied ✓</span>
                    ) : (
                      <button className="primary" onClick={() => markApplied(m)}>I applied — log it</button>
                    )}
                    <button onClick={() => dismiss(m)}>Not for me</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ProfileEditor({ initial, resume, onSave }: {
  initial: ProfileRecord | null;
  resume: ResumeData;
  onSave: (p: Omit<ProfileRecord, "user_id">) => void;
}) {
  const [skills, setSkills] = useState((initial?.skills ?? []).join(", "));
  const [locations, setLocations] = useState((initial?.locations ?? []).join(", "));
  const [countries, setCountries] = useState<string[]>(initial?.countries ?? []);
  const [seniority, setSeniority] = useState(initial?.seniority_target ?? "");
  const [listSize, setListSize] = useState(initial?.daily_list_size ?? 30);
  const [needsSponsorship, setNeedsSponsorship] = useState(initial?.needs_sponsorship ?? false);
  const [dailyEmail, setDailyEmail] = useState(initial?.daily_email ?? false);

  const toggle = (c: string) =>
    setCountries((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  return (
    <div className="card auth-card">
      <h3>Your match profile</h3>
      <p className="hint">Used only to rank the public jobs feed for you, by deterministic rules — no AI decides your list.</p>
      <button onClick={() => {
        const fromResume = profileFromResume(resume);
        if (fromResume.skills.length) setSkills(fromResume.skills.join(", "));
        if (fromResume.locations.length) setLocations(fromResume.locations.join(", "));
      }}>Fill skills &amp; locations from my resume</button>
      <label className="field">Skills (comma-separated)
        <input placeholder="react, typescript, sql" value={skills} onChange={(e) => setSkills(e.target.value)} />
      </label>
      <label className="field">Preferred locations
        <input placeholder="bengaluru, remote" value={locations} onChange={(e) => setLocations(e.target.value)} />
      </label>
      <div className="field-grid">
        <label className="field">Seniority target
          <select value={seniority} onChange={(e) => setSeniority(e.target.value)}>
            <option value="">Any</option>
            <option value="intern">Intern</option>
            <option value="junior">Junior / New grad</option>
            <option value="mid">Mid</option>
            <option value="senior">Senior</option>
            <option value="staff">Staff+</option>
            <option value="lead">Lead / Manager</option>
          </select>
        </label>
        <label className="field">Jobs per day (5–50)
          <input type="number" min={5} max={50} value={listSize}
            onChange={(e) => setListSize(Number(e.target.value) || 30)} />
        </label>
      </div>
      <div className="pref-group">
        <span className="pref-title">Countries — pick everywhere you can and want to work</span>
        <div className="country-grid">
          {Object.entries(COUNTRY_LABELS).map(([code, label]) => (
            <label className="check" key={code}>
              <input type="checkbox" checked={countries.includes(code)} onChange={() => toggle(code)} /> {label}
            </label>
          ))}
        </div>
      </div>
      <div className="pref-group">
        <label className="check pref-line" title="Postings that state they cannot sponsor are removed from your list entirely">
          <input type="checkbox" checked={needsSponsorship} onChange={(e) => setNeedsSponsorship(e.target.checked)} />
          <span>I need visa sponsorship <em>— postings that say "won't sponsor" are removed from your list</em></span>
        </label>
        <label className="check pref-line" title="One email a day with your ranked list — nothing when there are no matches. Off by default.">
          <input type="checkbox" checked={dailyEmail} onChange={(e) => setDailyEmail(e.target.checked)} />
          <span>Email me my daily list <em>— one email a day, nothing on empty days, off by default</em></span>
        </label>
      </div>
      <button className="primary" onClick={() => onSave({
        full_name: initial?.full_name ?? null,
        headline: initial?.headline ?? null,
        skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
        locations: locations.split(",").map((s) => s.trim()).filter(Boolean),
        countries,
        seniority_target: seniority || null,
        daily_list_size: listSize,
        needs_sponsorship: needsSponsorship,
        daily_email: dailyEmail,
      })}>Save profile</button>
    </div>
  );
}
