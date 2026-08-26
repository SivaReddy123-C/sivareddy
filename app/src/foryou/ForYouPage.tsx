import { useEffect, useState } from "react";
import { daysSince } from "../lib/stats.js";
import { uid } from "../lib/storage.js";
import { buildApplicationPack } from "../lib/pack.js";
import type { AnswerEntry, Application, ResumeData } from "../lib/types.js";
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
  async function copyPack(id: string) {
    await navigator.clipboard.writeText(buildApplicationPack(resume, answers));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [matches, setMatches] = useState<MatchRecord[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const db = supabase();
        const { data, error: pErr } = await db
          .from("jr_user_profiles").select("*").eq("user_id", session.user.id).maybeSingle();
        if (pErr) throw pErr;
        if (data) {
          setProfile(data as ProfileRecord);
          setMatches(await fetchMatches());
        } else {
          setEditing(true);
        }
      } catch (err) {
        setError((err as Error).message);
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
      setEditing(false);
      setMatches(await fetchMatches());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function markApplied(m: MatchRecord) {
    const posting = m.jr_job_postings;
    if (!posting) return;
    const now = new Date().toISOString();
    onChange([
      {
        id: uid(), company: posting.jr_companies?.name ?? "", title: posting.title,
        url: posting.url, location: posting.location, source: "jobradar",
        appliedAt: now, status: "applied", statusChangedAt: now, notes: "",
      },
      ...applications,
    ]);
    try {
      await setMatchStatus(m.id, "applied");
      await logApplicationEvent(session.user.id, posting);
      setMatches((ms) => ms?.map((x) => (x.id === m.id ? { ...x, status: "applied" } : x)) ?? null);
    } catch {
      // Local tracker entry stands even if the cloud write hiccups.
    }
  }

  async function dismiss(m: MatchRecord) {
    try {
      await setMatchStatus(m.id, "dismissed");
      setMatches((ms) => ms?.filter((x) => x.id !== m.id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="foryou">
      <div className="foryou-head">
        <span className="jobs-meta">Signed in as {session.user.email}</span>
        <button onClick={() => setEditing((v) => !v)}>{editing ? "Close profile" : "Edit profile"}</button>
        <button onClick={() => supabase().auth.signOut()}>Sign out</button>
      </div>
      {error && <p className="jobs-error">{error}</p>}

      {editing && <ProfileEditor initial={profile} onSave={saveProfile} />}

      {!editing && matches !== null && matches.length === 0 && (
        <p className="empty-hint">
          Your list appears after the next daily ranking run (03:17 UTC) — it ranks the scored
          feed against your profile and picks your top matches, ghosts excluded.
        </p>
      )}

      {!editing && matches !== null && matches.filter((m) => m.status !== "dismissed").length > 0 && (
        <>
          <p className="jobs-meta">
            Your top matches for {matches[0]!.match_date} · ghosts (score ≥50) excluded before ranking ·
            every match explains itself
          </p>
          <div className="job-list">
            {matches.filter((m) => m.status !== "dismissed").map((m) => {
              const p = m.jr_job_postings;
              if (!p) return null;
              const posted = p.posted_at ?? p.first_seen_at;
              return (
                <div className="card job-card" key={m.id}>
                  <div className="job-main">
                    <div className="job-title">
                      <span className="rank-chip">#{m.rank}</span>{" "}
                      <strong>{p.jr_companies?.name}</strong> · {p.title}
                    </div>
                    <div className="job-meta">
                      {p.location} · posted {daysSince(posted)}d ago
                      {p.has_salary && <span className="tag tag-salary">salary stated</span>}
                      {p.sponsorship === "no" && <span className="tag tag-nosponsor">won't sponsor</span>}
                      <span className="tag">fit {m.fit_score}</span>
                      {m.ghost_score_at_match !== null && <span className="tag">ghost {m.ghost_score_at_match}</span>}
                    </div>
                    <ul className="fit-reasons">
                      {(m.fit_reasons ?? []).map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                  <div className="job-actions">
                    <a className="btn-link" href={p.url} target="_blank" rel="noreferrer">Open posting ↗</a>
                    <button onClick={() => copyPack(m.id)}>{copiedId === m.id ? "Copied ✓" : "Copy pack"}</button>
                    {m.status === "applied" ? (
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

function ProfileEditor({ initial, onSave }: {
  initial: ProfileRecord | null;
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
      <label className="field">Skills (comma-separated)
        <input placeholder="react, typescript, sql" value={skills} onChange={(e) => setSkills(e.target.value)} />
      </label>
      <label className="field">Preferred locations
        <input placeholder="bengaluru, remote" value={locations} onChange={(e) => setLocations(e.target.value)} />
      </label>
      <div className="row">
        <label className="check"><input type="checkbox" checked={countries.includes("in")} onChange={() => toggle("in")} /> India</label>
        <label className="check"><input type="checkbox" checked={countries.includes("us")} onChange={() => toggle("us")} /> USA</label>
        <label className="check" title="Postings that state they cannot sponsor are removed from your list entirely">
          <input type="checkbox" checked={needsSponsorship} onChange={(e) => setNeedsSponsorship(e.target.checked)} /> I need visa sponsorship
        </label>
        <label className="check" title="One email a day with your ranked list — nothing when there are no matches. Off by default.">
          <input type="checkbox" checked={dailyEmail} onChange={(e) => setDailyEmail(e.target.checked)} /> Email me my daily list
        </label>
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
        <label className="field">List size
          <input type="number" min={5} max={50} value={listSize}
            onChange={(e) => setListSize(Number(e.target.value) || 30)} />
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
