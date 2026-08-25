/**
 * AI suggestions - bring-your-own-key, browser-direct.
 *
 * The user's Anthropic API key lives in THEIR browser (localStorage) and calls
 * go directly from their browser to Anthropic. No JobRadar server exists to
 * see the key or the resume. What is sent: only the text being improved plus
 * the minimal context shown in the prompt below. The SDK is loaded lazily so
 * users who never touch AI never download it.
 */

const KEY_STORAGE = "jobradar.anthropic_key";
const MODEL = "claude-opus-5";

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Private mode - key just won't persist across reloads.
  }
}

export type SuggestKind = "summary" | "bullet";

export interface SuggestContext {
  headline?: string;
  role?: string;
  company?: string;
  skills?: string;
}

const SYSTEM = `You improve resume writing for students and early-career engineers.
Rules: keep every factual claim from the original - never invent numbers, employers, titles, or achievements.
If the original lacks a metric, you may insert the placeholder [X] where the writer should add one.
Prefer strong action verbs, concrete specifics, and tight sentences. No buzzwords, no "passionate".
Return ONLY a JSON array of exactly 2 strings - two alternative improved versions. No other text.`;

export async function suggest(kind: SuggestKind, text: string, ctx: SuggestContext): Promise<string[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key set");

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const contextLines = [
    ctx.headline && `Candidate headline: ${ctx.headline}`,
    ctx.role && `Role: ${ctx.role}`,
    ctx.company && `Company: ${ctx.company}`,
    ctx.skills && `Skills: ${ctx.skills}`,
  ].filter(Boolean).join("\n");

  const ask = kind === "summary"
    ? `Improve this resume summary (2-3 lines max):\n${text}`
    : `Improve this resume bullet point (one line):\n${text}`;

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      messages: [{ role: "user", content: `${contextLines}\n\n${ask}` }],
    });
    if (response.stop_reason === "refusal") {
      throw new Error("The model declined this request.");
    }
    const textOut = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseSuggestions(textOut);
  } catch (err) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error("API key was rejected — check it in AI settings.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("Rate limited — wait a moment and try again.");
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new Error("Couldn't reach the API — check your connection.");
    }
    throw err;
  }
}

export function parseSuggestions(raw: string): string[] {
  // Model is instructed to return a bare JSON array; tolerate fenced output.
  const cleaned = raw.trim().replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Unexpected response format");
  const arr = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) {
    throw new Error("Unexpected response format");
  }
  return arr.slice(0, 3);
}
