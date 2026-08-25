import { useEffect, useMemo, useState } from "react";
import { exportJson, importJson, loadState, saveState } from "./lib/storage.js";
import type { AppState } from "./lib/types.js";
import { ResumePage } from "./resume/ResumePage.js";
import { TrackerPage } from "./tracker/TrackerPage.js";

type Tab = "resume" | "tracker";

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>("resume");

  // Persist on every change - the browser is the database.
  useEffect(() => saveState(state), [state]);

  const accepted = useMemo(
    () => state.applications.some((a) => a.status === "accepted"),
    [state.applications],
  );

  function download() {
    const blob = new Blob([exportJson(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jobradar-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function upload(file: File) {
    file.text().then((text) => {
      try {
        setState(importJson(text));
      } catch {
        alert("That file doesn't look like a JobRadar export.");
      }
    });
  }

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="brand">
          <strong>JobRadar</strong>
          <span className="tagline">your data stays in your browser</span>
        </div>
        <nav>
          <button className={tab === "resume" ? "active" : ""} onClick={() => setTab("resume")}>
            Resume
          </button>
          <button className={tab === "tracker" ? "active" : ""} onClick={() => setTab("tracker")}>
            Tracker{state.applications.length > 0 ? ` (${state.applications.length})` : ""}
          </button>
        </nav>
        <div className="data-actions">
          <button onClick={download}>Export data</button>
          <label className="filebtn">
            Import
            <input
              type="file"
              accept="application/json"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </label>
        </div>
      </header>

      {accepted && (
        <div className="celebrate no-print">
          🎉 You accepted an offer! If JobRadar helped, a one-time contribution funds the next
          student — completely optional, and the books are public. (Pay-it-forward link coming with
          the open ledger.)
        </div>
      )}

      {tab === "resume" ? (
        <ResumePage resume={state.resume} onChange={(resume) => setState((s) => ({ ...s, resume }))} />
      ) : (
        <TrackerPage
          applications={state.applications}
          onChange={(applications) => setState((s) => ({ ...s, applications }))}
        />
      )}

      <footer className="foot no-print">
        Free while you job-hunt. Open source, open books, no accounts, no credential custody.
        Export your data any time — it's yours.
      </footer>
    </div>
  );
}
