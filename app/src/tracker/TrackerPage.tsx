import { useState } from "react";
import { computeStats, daysSince, GHOSTED_AFTER_DAYS, isLikelyGhosted } from "../lib/stats.js";
import { uid } from "../lib/storage.js";
import type { Application, AppStatus } from "../lib/types.js";

const STATUS_LABEL: Record<AppStatus, string> = {
  applied: "Applied",
  replied: "Got a reply",
  interview: "Interviewing",
  offer: "Offer!",
  accepted: "Accepted 🎉",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

interface Props {
  applications: Application[];
  onChange: (apps: Application[]) => void;
}

export function TrackerPage({ applications, onChange }: Props) {
  const stats = computeStats(applications);
  const [draft, setDraft] = useState({ company: "", title: "", url: "", location: "", source: "" });

  function add() {
    if (!draft.company.trim() && !draft.title.trim()) return;
    const now = new Date().toISOString();
    onChange([
      {
        id: uid(),
        ...draft,
        appliedAt: now,
        status: "applied",
        statusChangedAt: now,
        notes: "",
      },
      ...applications,
    ]);
    setDraft({ company: "", title: "", url: "", location: "", source: "" });
  }

  function update(id: string, patch: Partial<Application>) {
    onChange(applications.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function setStatus(id: string, status: AppStatus) {
    update(id, { status, statusChangedAt: new Date().toISOString() });
  }

  return (
    <div className="tracker">
      <div className="stats-bar">
        <Stat label="Applications" value={String(stats.total)} />
        <Stat label="Reply rate" value={stats.replyRate === null ? "—" : `${stats.replyRate}%`}
          hint="Any human response counts, including rejections." />
        <Stat label="Interviews" value={String(stats.interviews)} />
        <Stat label="Offers" value={String(stats.offers)} />
        <Stat label={`Likely ghosted (${GHOSTED_AFTER_DAYS}d+)`} value={String(stats.likelyGhosted)}
          hint="No response after three weeks. It's them, not you." />
      </div>

      <div className="card add-form">
        <h3>Log an application</h3>
        <div className="grid2">
          <input placeholder="Company" value={draft.company}
            onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
          <input placeholder="Role / title" value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input placeholder="Job URL (optional)" value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <input placeholder="Location (optional)" value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
          <input placeholder="Source (company site, referral...)" value={draft.source}
            onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
        </div>
        <button className="primary" onClick={add}>Add — logged as applied today</button>
      </div>

      {applications.length === 0 ? (
        <p className="empty-hint">
          Log every application here the moment you send it. The tracker is what turns your job
          hunt from a black hole into data — yours first, and later (only if you opt in) the
          anonymous fuel for an employer accountability scorecard.
        </p>
      ) : (
        <div className="app-list">
          {applications.map((a) => (
            <div className={`card app-row status-${a.status} ${isLikelyGhosted(a) ? "ghosted" : ""}`} key={a.id}>
              <div className="app-main">
                <div className="app-title">
                  <strong>{a.company || "—"}</strong> · {a.title || "—"}
                  {a.url && <> · <a href={a.url} target="_blank" rel="noreferrer">posting</a></>}
                </div>
                <div className="app-meta">
                  Applied {a.appliedAt.slice(0, 10)} ({daysSince(a.appliedAt)}d ago)
                  {a.location && <> · {a.location}</>}
                  {a.source && <> · via {a.source}</>}
                  {isLikelyGhosted(a) && <span className="ghost-badge"> likely ghosted</span>}
                </div>
                <textarea
                  className="notes"
                  rows={1}
                  placeholder="Notes (who you spoke to, next step...)"
                  value={a.notes}
                  onChange={(e) => update(a.id, { notes: e.target.value })}
                />
              </div>
              <div className="app-actions">
                <select value={a.status} onChange={(e) => setStatus(a.id, e.target.value as AppStatus)}>
                  {(Object.keys(STATUS_LABEL) as AppStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={a.appliedAt.slice(0, 10)}
                  onChange={(e) => e.target.value && update(a.id, { appliedAt: new Date(e.target.value).toISOString() })}
                  title="Applied date"
                />
                <button className="danger" onClick={() => onChange(applications.filter((x) => x.id !== a.id))}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
