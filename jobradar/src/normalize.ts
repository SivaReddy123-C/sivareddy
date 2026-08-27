const MAX_DESC = 3000;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&");
}

/** Strip HTML tags/entities into readable plain text. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  // Greenhouse serves descriptions with HTML-escaped entities (&lt;p&gt;...),
  // so decode first, strip tags, then decode what the first pass revealed.
  const text = decodeEntities(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();
  const decoded = decodeEntities(text).trim();
  return decoded ? decoded.slice(0, MAX_DESC) : null;
}

export function toIso(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Key for tracking the same "job slot" across reposts (id changes, role doesn't). */
export function slotKey(source: string, companyToken: string, title: string, location: string): string {
  // Upstream boards are not obliged to send well-formed records: a single
  // Workday posting with no title once crashed a whole 300-board run here.
  const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${source}|${companyToken}|${norm(title)}|${norm(location)}`;
}

const INDIA_HINTS = [
  "india", "bengaluru", "bangalore", "hyderabad", "chennai", "mumbai", "pune",
  "gurgaon", "gurugram", "noida", "delhi", "kolkata", "ahmedabad", "kochi",
  "thiruvananthapuram", "trivandrum", "jaipur", "indore", "coimbatore", "remote - india",
];

export function looksIndian(location: string): boolean {
  const l = location.toLowerCase();
  return INDIA_HINTS.some((h) => l.includes(h));
}

const US_STATE_CODES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US_STATE_RE = new RegExp(`,\\s*(${US_STATE_CODES})\\b`);
const US_HINTS = [
  "united states", "usa", "u.s.", "remote - us", "us remote", "remote (us",
  "new york", "san francisco", "seattle", "austin", "boston", "chicago",
  "los angeles", "denver", "atlanta", "dallas", "miami", "washington",
];

export type Country = "in" | "us" | "gb" | "de" | "nl" | "ae" | "ca" | "sg" | "au" | "se" | "fr" | "ie";

const COUNTRY_HINTS: Record<Exclude<Country, "in" | "us">, string[]> = {
  gb: ["united kingdom", "uk", "london", "manchester", "cambridge, uk", "edinburgh"],
  de: ["germany", "deutschland", "berlin", "munich", "münchen", "stuttgart", "hamburg", "frankfurt", "cologne", "karlsruhe", "leonberg", "renningen", "abstatt", "hildesheim", ", de"],
  nl: ["netherlands", "amsterdam", "eindhoven", "rotterdam", ", nl"],
  ae: ["united arab emirates", "uae", "dubai", "abu dhabi", "sharjah"],
  ca: ["canada", "toronto", "vancouver", "montreal", "ottawa", "waterloo", ", ca"],
  sg: ["singapore"],
  au: ["australia", "sydney", "melbourne", "brisbane", "perth"],
  se: ["sweden", "stockholm", "gothenburg"],
  fr: ["france", "paris", "lyon", "grenoble"],
  ie: ["ireland", "dublin", "cork"],
};

export function matchesCountry(location: string, country: Country): boolean {
  const l = location.toLowerCase();
  if (country === "in") return looksIndian(location);
  if (country === "us") return US_HINTS.some((h) => l.includes(h)) || US_STATE_RE.test(location);
  return COUNTRY_HINTS[country].some((h) => h.startsWith(",") ? l.endsWith(h) || l.includes(h + ";") : l.includes(h));
}

export const ALL_COUNTRIES: Country[] = ["in", "us", "gb", "de", "nl", "ae", "ca", "sg", "au", "se", "fr", "ie"];

/** Best-effort country for a location string; null when nothing matches. */
export function detectCountry(location: string): Country | null {
  for (const c of ALL_COUNTRIES) {
    if (matchesCountry(location, c)) return c;
  }
  return null;
}

export type SponsorshipSignal = "no" | "yes" | "unknown";

const NO_SPONSOR_RE =
  /(unable|not able|cannot|can't|will not|won't|not (currently )?(willing|offering)|do(es)? not (offer|provide)|no) (to )?(visa )?sponsor(ship)?|without (visa )?sponsorship,? now or in the future|must (be|have) (legally )?(authorized|authorization) to work|not (eligible|available) for (visa )?sponsorship/i;
const YES_SPONSOR_RE =
  /(visa )?sponsorship (is )?(available|offered|provided|possible)|(will|can|do|happy to) sponsor|h-?1b (sponsorship|transfer|visa)|support (work )?visa/i;

/**
 * Detect visa-sponsorship stance from a job description.
 * "no" is high-precision (employers state it bluntly); "yes" is rarer in text;
 * most postings simply do not say - that is honestly "unknown", not "yes".
 */
export function sponsorshipSignal(description: string | null): SponsorshipSignal {
  if (!description) return "unknown";
  if (NO_SPONSOR_RE.test(description)) return "no";
  if (YES_SPONSOR_RE.test(description)) return "yes";
  return "unknown";
}
