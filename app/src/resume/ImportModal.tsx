import { useState } from "react";
import { getApiKey, parseResumeText } from "../lib/ai.js";
import { applyParsed, extractPdfText, parsedSummary, type ParsedResume } from "../lib/importer.js";
import type { ResumeData } from "../lib/types.js";

/**
 * Import an existing resume PDF. Three explicit steps, nothing silent:
 * extract (in-browser) -> show the ATS X-ray -> optional AI parse with the
 * user's own key -> preview -> apply. The editor is only touched on Apply.
 */
export function ImportModal({ resume, onApply, onClose }: {
  resume: ResumeData;
  onApply: (r: ResumeData) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState<ParsedResume | null>(null);
  const hasKey = Boolean(getApiKey());

  async function onFile(file: File) {
    setBusy("Extracting text in your browser (the file doesn't leave your machine)…");
    setError("");
    setParsed(null);
    try {
      setText(await extractPdfText(file));
    } catch (err) {
      const looksLikeExport = file.name.endsWith(".json");
      setError(looksLikeExport
        ? "That's a JobRadar data file, not a PDF - close this and use \"Import data (.json)\" in the top-right corner of the page instead."
        : `Couldn't read that PDF: ${(err as Error).message}`);
    } finally {
      setBusy("");
    }
  }

  async function aiParse() {
    setBusy("Parsing with your API key (resume text goes browser → Anthropic, nowhere else)…");
    setError("");
    try {
      setParsed((await parseResumeText(text)) as ParsedResume);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h3>Import your existing resume</h3>
          <button onClick={onClose}>Close</button>
        </div>

        {!text && (
          <>
            <p className="hint">
              Upload your current resume PDF. Step one runs entirely in your browser and shows
              the <strong>ATS X-ray</strong> — the exact text a parsing machine extracts from
              your file, in the order it sees it. If it looks scrambled, that's what ATSs see too.
            </p>
            <label className="filebtn">
              Choose PDF
              <input type="file" accept="application/pdf"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </>
        )}

        {busy && <p className="hint">{busy}</p>}
        {error && <p className="ai-error">{error}</p>}

        {text && !parsed && (
          <>
            <h4 className="xray-title">ATS X-ray — what a machine sees in your current resume</h4>
            <pre className="pack-preview xray">{text.slice(0, 4000)}{text.length > 4000 ? "\n…" : ""}</pre>
            {hasKey ? (
              <button className="primary" disabled={!!busy} onClick={aiParse}>
                Parse into the editor with AI (your key)
              </button>
            ) : (
              <p className="hint">
                To convert this into the editor automatically, add your Anthropic API key under
                <strong> AI: set up</strong> in the toolbar — or copy sections across by hand.
              </p>
            )}
          </>
        )}

        {parsed && (
          <>
            <h4 className="xray-title">Parsed — review before applying</h4>
            <p className="hint">{parsedSummary(parsed)}</p>
            <pre className="pack-preview xray">{JSON.stringify(parsed, null, 1).slice(0, 4000)}</pre>
            <div className="row">
              <button className="primary" onClick={() => { onApply(applyParsed(resume, parsed)); onClose(); }}>
                Apply to editor (replaces current content; template & colors kept)
              </button>
              <button onClick={() => setParsed(null)}>Back</button>
            </div>
            <p className="hint">
              Nothing is invented: unknown fields stay empty, and you can edit everything after
              applying. Check dates and numbers — parsing is good, not perfect.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
