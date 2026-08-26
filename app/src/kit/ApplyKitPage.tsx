import { useMemo, useState } from "react";
import { buildApplicationPack } from "../lib/pack.js";
import { uid } from "../lib/storage.js";
import type { AnswerEntry, ResumeData } from "../lib/types.js";

interface Props {
  resume: ResumeData;
  answers: AnswerEntry[];
  onChange: (a: AnswerEntry[]) => void;
}

/**
 * The apply kit: answer common screening questions once, reuse everywhere.
 * "Copy pack" puts contact info + answers + skills on the clipboard for fast
 * paste-filling; the browser extension automates the same data later.
 */
export function ApplyKitPage({ resume, answers, onChange }: Props) {
  const [copied, setCopied] = useState(false);
  const pack = useMemo(() => buildApplicationPack(resume, answers), [resume, answers]);

  const update = (id: string, patch: Partial<AnswerEntry>) =>
    onChange(answers.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  async function copy() {
    await navigator.clipboard.writeText(pack);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="kit">
      <div className="kit-cols">
        <div className="card">
          <h3>Your standard answers</h3>
          <p className="hint">
            The questions every application asks. Answer once here — honestly; these go to real
            employers under your name. Contact details come from your resume automatically.
          </p>
          {answers.map((a) => (
            <div className="kit-row" key={a.id}>
              <input className="kit-label" value={a.label}
                onChange={(e) => update(a.id, { label: e.target.value })} />
              <input placeholder="Your answer" value={a.value}
                onChange={(e) => update(a.id, { value: e.target.value })} />
              <button className="danger" onClick={() => onChange(answers.filter((x) => x.id !== a.id))}>×</button>
            </div>
          ))}
          <button onClick={() => onChange([...answers, { id: uid(), label: "", value: "" }])}>
            + Add a question
          </button>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Application pack</h3>
            <button className="primary" onClick={copy}>{copied ? "Copied ✓" : "Copy pack"}</button>
          </div>
          <p className="hint">
            Everything above as clean text. On any application form: copy, then paste field by
            field. The same button lives on every job card.
          </p>
          <pre className="pack-preview">{pack || "Fill your resume contact details and answers to build the pack."}</pre>
        </div>
      </div>
    </div>
  );
}
