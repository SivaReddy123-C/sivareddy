import { useState } from "react";
import { uid } from "../lib/storage.js";
import { checkBullet, checkSummary } from "../lib/writecheck.js";
import type {
  EducationEntry, ExperienceEntry, ProjectEntry, ResumeData, ResumeSettings,
  SectionKey, SkillGroup, TemplateId,
} from "../lib/types.js";
import { AiSettings, AiSuggest } from "./AiSuggest.js";
import { ImportModal } from "./ImportModal.js";
import { Hints } from "./Hints.js";
import { ResumePreview } from "./ResumePreview.js";

const TEMPLATES: { id: TemplateId; label: string }[] = [
  { id: "classic", label: "Classic — serif, single column" },
  { id: "compact", label: "Compact — tight, accent headings" },
  { id: "modern", label: "Modern — bold name, accent bar" },
  { id: "elegant", label: "Elegant — centered serif header" },
  { id: "mono", label: "Mono — technical monospace" },
  { id: "minimal", label: "Minimal — whitespace, no rules" },
];

const SECTION_LABEL: Record<SectionKey, string> = {
  summary: "Summary", experience: "Experience", projects: "Projects",
  education: "Education", skills: "Skills",
};

interface Props {
  resume: ResumeData;
  onChange: (r: ResumeData) => void;
}

export function ResumePage({ resume, onChange }: Props) {
  const [showEditor, setShowEditor] = useState(true);
  const [importing, setImporting] = useState(false);
  const [summaryActive, setSummaryActive] = useState(false);
  const [settled, setSettled] = useState<string[]>([]);
  const isSettled = (t: string) => settled.includes(t.trim());
  const settle = (t: string) => setSettled((s) => (s.includes(t.trim()) ? s : [...s, t.trim()]));
  const set = (patch: Partial<ResumeData>) => onChange({ ...resume, ...patch });
  const setSettings = (patch: Partial<ResumeSettings>) =>
    set({ settings: { ...resume.settings, ...patch } });
  const skillsSummary = resume.skills.map((s) => s.items).filter(Boolean).join(", ");

  return (
    <div className="resume-page">
      <div className="resume-toolbar no-print">
        <button onClick={() => setShowEditor((v) => !v)}>
          {showEditor ? "Hide editor" : "Show editor"}
        </button>
        <label>
          Template{" "}
          <select
            value={resume.template}
            onChange={(e) => set({ template: e.target.value as TemplateId })}
          >
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label>
          Accent{" "}
          <input
            type="color"
            className="colorpick"
            value={resume.settings.accent}
            onChange={(e) => setSettings({ accent: e.target.value })}
          />
        </label>
        <label>
          Font{" "}
          <select value={resume.settings.font}
            onChange={(e) => setSettings({ font: e.target.value as ResumeSettings["font"] })}>
            <option value="template">Template default</option>
            <option value="serif">Serif</option>
            <option value="sans">Sans</option>
            <option value="mono">Mono</option>
          </select>
        </label>
        <label>
          Density{" "}
          <select value={resume.settings.density}
            onChange={(e) => setSettings({ density: e.target.value as ResumeSettings["density"] })}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <button onClick={() => setImporting(true)}>Import resume (PDF)</button>
        <AiSettings />
        <button className="primary" onClick={() => window.print()}>
          Download PDF
        </button>
        <span className="hint">PDF uses your browser's print dialog — choose "Save as PDF".</span>
      </div>

      {importing && (
        <ImportModal resume={resume} onApply={onChange} onClose={() => setImporting(false)} />
      )}
      <div className={`resume-split ${showEditor ? "" : "preview-only"}`}>
        {showEditor && (
          <div className="editor no-print">
            <BasicsEditor resume={resume} set={set} />
            <SectionOrderCard order={resume.settings.sectionOrder}
              onChange={(sectionOrder) => setSettings({ sectionOrder })} />
            <SectionCard title="Summary">
              <textarea
                rows={3}
                placeholder="Two or three lines. What you do, what you're strong at, what you're looking for."
                value={resume.summary}
                onChange={(e) => set({ summary: e.target.value })}
                onFocus={() => setSummaryActive(true)}
              />
              <Hints hints={checkSummary(resume.summary)}
                show={summaryActive && !isSettled(resume.summary)}
                onDismiss={() => settle(resume.summary)} />
              {summaryActive && (
                <AiSuggest kind="summary" text={resume.summary}
                  context={{ headline: resume.basics.headline, skills: skillsSummary }}
                  onApply={(summary) => { set({ summary }); settle(summary); }} />
              )}
            </SectionCard>
            <EducationEditor entries={resume.education} onChange={(education) => set({ education })} />
            <ExperienceEditor entries={resume.experience} onChange={(experience) => set({ experience })} />
            <ProjectsEditor entries={resume.projects} onChange={(projects) => set({ projects })} />
            <SkillsEditor entries={resume.skills} onChange={(skills) => set({ skills })} />
          </div>
        )}
        <div className="preview-pane">
          <ResumePreview resume={resume} />
        </div>
      </div>
    </div>
  );
}

function SectionOrderCard({ order, onChange }: { order: SectionKey[]; onChange: (o: SectionKey[]) => void }) {
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    const a = next[i]!; next[i] = next[j]!; next[j] = a;
    onChange(next);
  }
  return (
    <section className="card">
      <div className="card-head"><h3>Section order</h3></div>
      <p className="hint">Freshers usually lead with Education or Projects; experienced folks with Experience.</p>
      <div className="order-list">
        {order.map((k, i) => (
          <div className="order-row" key={k}>
            <span>{SECTION_LABEL[k]}</span>
            <span>
              <button disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionCard({ title, children, onAdd }: { title: string; children: React.ReactNode; onAdd?: () => void }) {
  return (
    <section className="card">
      <div className="card-head">
        <h3>{title}</h3>
        {onAdd && <button onClick={onAdd}>+ Add</button>}
      </div>
      {children}
    </section>
  );
}

function BasicsEditor({ resume, set }: { resume: ResumeData; set: (p: Partial<ResumeData>) => void }) {
  const b = resume.basics;
  const setB = (patch: Partial<ResumeData["basics"]>) => set({ basics: { ...b, ...patch } });
  return (
    <SectionCard title="Contact">
      <div className="grid2">
        <input placeholder="Full name" value={b.name} onChange={(e) => setB({ name: e.target.value })} />
        <input placeholder="Headline (e.g. Frontend Engineer)" value={b.headline} onChange={(e) => setB({ headline: e.target.value })} />
        <input placeholder="Email" value={b.email} onChange={(e) => setB({ email: e.target.value })} />
        <input placeholder="Phone" value={b.phone} onChange={(e) => setB({ phone: e.target.value })} />
        <input placeholder="Location (e.g. Bengaluru, IN)" value={b.location} onChange={(e) => setB({ location: e.target.value })} />
      </div>
      <div className="links">
        {b.links.map((l, i) => (
          <div className="grid2" key={i}>
            <input placeholder="Label (GitHub, LinkedIn...)" value={l.label}
              onChange={(e) => setB({ links: b.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <div className="row">
              <input placeholder="https://..." value={l.url}
                onChange={(e) => setB({ links: b.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              <button className="danger" onClick={() => setB({ links: b.links.filter((_, j) => j !== i) })}>×</button>
            </div>
          </div>
        ))}
        <button onClick={() => setB({ links: [...b.links, { label: "", url: "" }] })}>+ Add link</button>
      </div>
    </SectionCard>
  );
}

function EducationEditor({ entries, onChange }: { entries: EducationEntry[]; onChange: (e: EducationEntry[]) => void }) {
  const update = (id: string, patch: Partial<EducationEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  return (
    <SectionCard title="Education" onAdd={() => onChange([...entries, { id: uid(), school: "", degree: "", start: "", end: "", score: "", details: "" }])}>
      {entries.map((e) => (
        <div className="entry" key={e.id}>
          <div className="grid2">
            <input placeholder="School / University" value={e.school} onChange={(ev) => update(e.id, { school: ev.target.value })} />
            <input placeholder="Degree (B.Tech CSE...)" value={e.degree} onChange={(ev) => update(e.id, { degree: ev.target.value })} />
            <input placeholder="Start (2022)" value={e.start} onChange={(ev) => update(e.id, { start: ev.target.value })} />
            <input placeholder="End (2026 / expected)" value={e.end} onChange={(ev) => update(e.id, { end: ev.target.value })} />
            <input placeholder="GPA / % (optional)" value={e.score} onChange={(ev) => update(e.id, { score: ev.target.value })} />
          </div>
          <input placeholder="Details (coursework, honors) — optional" value={e.details} onChange={(ev) => update(e.id, { details: ev.target.value })} />
          <button className="danger" onClick={() => onChange(entries.filter((x) => x.id !== e.id))}>Remove</button>
        </div>
      ))}
    </SectionCard>
  );
}

function BulletsEditor({ bullets, onChange, placeholder, aiContext }: {
  bullets: string[];
  onChange: (b: string[]) => void;
  placeholder: string;
  aiContext?: { role?: string; company?: string };
}) {
  // Only the bullet you're working on shows feedback. `active` survives blur so
  // the AI button stays clickable; it moves when another bullet is focused.
  const [active, setActive] = useState<number | null>(null);
  const [settled, setSettled] = useState<string[]>([]);
  const isSettled = (t: string) => settled.includes(t.trim());
  const settle = (t: string) => setSettled((s) => (s.includes(t.trim()) ? s : [...s, t.trim()]));

  return (
    <div className="bullets">
      {bullets.map((b, i) => (
        <div className="bullet-block" key={i}>
          <div className="row">
            <input placeholder={placeholder} value={b}
              onFocus={() => setActive(i)}
              onChange={(e) => onChange(bullets.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="danger" onClick={() => onChange(bullets.filter((_, j) => j !== i))}>×</button>
          </div>
          <Hints hints={checkBullet(b)}
            show={active === i && !isSettled(b)}
            onDismiss={() => settle(b)} />
          {active === i && (
            <AiSuggest kind="bullet" text={b} context={aiContext ?? {}}
              onApply={(v) => { onChange(bullets.map((x, j) => (j === i ? v : x))); settle(v); }} />
          )}
        </div>
      ))}
      <button onClick={() => onChange([...bullets, ""])}>+ Bullet</button>
    </div>
  );
}

function ExperienceEditor({ entries, onChange }: { entries: ExperienceEntry[]; onChange: (e: ExperienceEntry[]) => void }) {
  const update = (id: string, patch: Partial<ExperienceEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  return (
    <SectionCard title="Experience / Internships" onAdd={() => onChange([...entries, { id: uid(), company: "", role: "", location: "", start: "", end: "", bullets: [""] }])}>
      {entries.map((e) => (
        <div className="entry" key={e.id}>
          <div className="grid2">
            <input placeholder="Company" value={e.company} onChange={(ev) => update(e.id, { company: ev.target.value })} />
            <input placeholder="Role" value={e.role} onChange={(ev) => update(e.id, { role: ev.target.value })} />
            <input placeholder="Location" value={e.location} onChange={(ev) => update(e.id, { location: ev.target.value })} />
            <div className="row">
              <input placeholder="Start (Jun 2025)" value={e.start} onChange={(ev) => update(e.id, { start: ev.target.value })} />
              <input placeholder="End (Present)" value={e.end} onChange={(ev) => update(e.id, { end: ev.target.value })} />
            </div>
          </div>
          <BulletsEditor bullets={e.bullets} onChange={(bullets) => update(e.id, { bullets })}
            placeholder="Did X using Y, achieving Z (numbers beat adjectives)"
            aiContext={{ role: e.role, company: e.company }} />
          <button className="danger" onClick={() => onChange(entries.filter((x) => x.id !== e.id))}>Remove</button>
        </div>
      ))}
    </SectionCard>
  );
}

function ProjectsEditor({ entries, onChange }: { entries: ProjectEntry[]; onChange: (e: ProjectEntry[]) => void }) {
  const update = (id: string, patch: Partial<ProjectEntry>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  return (
    <SectionCard title="Projects" onAdd={() => onChange([...entries, { id: uid(), name: "", link: "", bullets: [""] }])}>
      {entries.map((e) => (
        <div className="entry" key={e.id}>
          <div className="grid2">
            <input placeholder="Project name" value={e.name} onChange={(ev) => update(e.id, { name: ev.target.value })} />
            <input placeholder="Link (GitHub / live) — optional" value={e.link} onChange={(ev) => update(e.id, { link: ev.target.value })} />
          </div>
          <BulletsEditor bullets={e.bullets} onChange={(bullets) => update(e.id, { bullets })}
            placeholder="What it does, what you built it with, what it achieved"
            aiContext={{ role: "personal project", company: e.name }} />
          <button className="danger" onClick={() => onChange(entries.filter((x) => x.id !== e.id))}>Remove</button>
        </div>
      ))}
    </SectionCard>
  );
}

function SkillsEditor({ entries, onChange }: { entries: SkillGroup[]; onChange: (e: SkillGroup[]) => void }) {
  const update = (id: string, patch: Partial<SkillGroup>) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  return (
    <SectionCard title="Skills" onAdd={() => onChange([...entries, { id: uid(), group: "", items: "" }])}>
      {entries.map((e) => (
        <div className="row" key={e.id}>
          <input className="narrow" placeholder="Group (Languages)" value={e.group} onChange={(ev) => update(e.id, { group: ev.target.value })} />
          <input placeholder="TypeScript, Python, SQL" value={e.items} onChange={(ev) => update(e.id, { items: ev.target.value })} />
          <button className="danger" onClick={() => onChange(entries.filter((x) => x.id !== e.id))}>×</button>
        </div>
      ))}
    </SectionCard>
  );
}
