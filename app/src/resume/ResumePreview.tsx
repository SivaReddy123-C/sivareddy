import type { ResumeData } from "../lib/types.js";

/**
 * Deliberately ATS-safe markup: single flow of headings, paragraphs, and lists.
 * No tables, no columns-as-tables, no icons; parsers read it the way humans do.
 */
export function ResumePreview({ resume }: { resume: ResumeData }) {
  const { basics } = resume;
  const has = {
    summary: resume.summary.trim().length > 0,
    education: resume.education.length > 0,
    experience: resume.experience.length > 0,
    projects: resume.projects.length > 0,
    skills: resume.skills.length > 0,
  };
  const empty = !basics.name && !has.summary && !has.education && !has.experience;

  return (
    <div className={`sheet template-${resume.template}`} id="resume-sheet">
      {empty ? (
        <p className="sheet-empty no-print">
          Your resume preview appears here as you type. Start with your name on the left.
        </p>
      ) : (
        <>
          <header className="r-head">
            <h1>{basics.name || "Your Name"}</h1>
            {basics.headline && <p className="r-headline">{basics.headline}</p>}
            <p className="r-contact">
              {[basics.email, basics.phone, basics.location]
                .filter(Boolean)
                .join(" · ")}
              {basics.links.filter((l) => l.url).map((l) => (
                <span key={l.url}> · <a href={l.url}>{l.label || l.url}</a></span>
              ))}
            </p>
          </header>

          {has.summary && (
            <section>
              <h2>Summary</h2>
              <p>{resume.summary}</p>
            </section>
          )}

          {has.experience && (
            <section>
              <h2>Experience</h2>
              {resume.experience.map((e) => (
                <div className="r-entry" key={e.id}>
                  <div className="r-entry-head">
                    <strong>{e.role}</strong>
                    <span>{[e.start, e.end].filter(Boolean).join(" – ")}</span>
                  </div>
                  <div className="r-entry-sub">
                    {[e.company, e.location].filter(Boolean).join(" · ")}
                  </div>
                  <ul>
                    {e.bullets.filter((b) => b.trim()).map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {has.projects && (
            <section>
              <h2>Projects</h2>
              {resume.projects.map((p) => (
                <div className="r-entry" key={p.id}>
                  <div className="r-entry-head">
                    <strong>{p.name}</strong>
                    {p.link && <a href={p.link}>{p.link.replace(/^https?:\/\//, "")}</a>}
                  </div>
                  <ul>
                    {p.bullets.filter((b) => b.trim()).map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {has.education && (
            <section>
              <h2>Education</h2>
              {resume.education.map((e) => (
                <div className="r-entry" key={e.id}>
                  <div className="r-entry-head">
                    <strong>{e.school}</strong>
                    <span>{[e.start, e.end].filter(Boolean).join(" – ")}</span>
                  </div>
                  <div className="r-entry-sub">
                    {[e.degree, e.score].filter(Boolean).join(" · ")}
                  </div>
                  {e.details && <p className="r-details">{e.details}</p>}
                </div>
              ))}
            </section>
          )}

          {has.skills && (
            <section>
              <h2>Skills</h2>
              {resume.skills.filter((s) => s.items.trim()).map((s) => (
                <p className="r-skill" key={s.id}>
                  {s.group && <strong>{s.group}: </strong>}
                  {s.items}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
