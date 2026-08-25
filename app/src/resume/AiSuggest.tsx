import { useState } from "react";
import { getApiKey, setApiKey, suggest, type SuggestContext, type SuggestKind } from "../lib/ai.js";

/**
 * The "suggest, never overwrite" widget: shows AI variants, user chooses.
 * Renders nothing but a setup hint when no key is configured.
 */
export function AiSuggest({ kind, text, context, onApply }: {
  kind: SuggestKind;
  text: string;
  context: SuggestContext;
  onApply: (value: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const hasKey = Boolean(getApiKey());

  if (!hasKey) return null;

  async function run() {
    setBusy(true);
    setError("");
    setOptions(null);
    try {
      setOptions(await suggest(kind, text, context));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-suggest">
      <button disabled={busy || !text.trim()} onClick={run} title="Uses your own API key; only this text and minimal context is sent">
        {busy ? "Thinking..." : "✨ AI suggest"}
      </button>
      {error && <span className="ai-error">{error}</span>}
      {options && (
        <div className="ai-options">
          {options.map((o, i) => (
            <div className="ai-option" key={i}>
              <span>{o}</span>
              <button onClick={() => { onApply(o); setOptions(null); }}>Use</button>
            </div>
          ))}
          <button className="ai-dismiss" onClick={() => setOptions(null)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

export function AiSettings() {
  const [key, setKey] = useState(getApiKey());
  const [open, setOpen] = useState(false);
  return (
    <div className="ai-settings">
      <button onClick={() => setOpen((v) => !v)}>
        {getApiKey() ? "AI: on" : "AI: set up"}
      </button>
      {open && (
        <div className="ai-settings-panel card">
          <h3>AI suggestions (bring your own key)</h3>
          <p className="hint">
            Optional. Paste an Anthropic API key (console.anthropic.com) and "✨ AI suggest"
            buttons appear next to your summary and bullets. The key is stored only in this
            browser; requests go directly from your browser to Anthropic — there is no
            JobRadar server. You pay Anthropic directly (a suggestion costs a fraction of a
            cent). The free writing hints below every field work without any key.
          </p>
          <div className="row">
            <input
              type="password"
              placeholder="sk-ant-..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="primary" onClick={() => { setApiKey(key); setOpen(false); }}>Save</button>
            {getApiKey() && (
              <button className="danger" onClick={() => { setApiKey(""); setKey(""); }}>Remove</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
