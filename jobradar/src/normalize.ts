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

export type Country =
  | "in" | "us" | "gb" | "de" | "nl" | "ae" | "ca" | "sg" | "au" | "se" | "fr" | "ie"
  // Added because 26,000 postings were landing with no country at all, which
  // made them invisible to anyone filtering by where they can actually work.
  // Hospitality and travel hire heavily across Asia and the Gulf in
  // particular, and none of it was reachable.
  | "th" | "my" | "ph" | "id" | "vn" | "jp" | "kr" | "tw" | "hk" | "cn"
  | "sa" | "qa" | "eg" | "il" | "tr" | "za" | "ke" | "nz"
  | "es" | "it" | "pl" | "pt" | "ch" | "dk" | "no" | "fi" | "be" | "at" | "cz" | "ro"
  | "br" | "mx" | "ar" | "cl" | "co";

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
  th: ["thailand", "bangkok", "phuket", "chiang mai"],
  my: ["malaysia", "kuala lumpur", "penang", "cyberjaya"],
  ph: ["philippines", "manila", "makati", "cebu", "taguig"],
  id: ["indonesia", "jakarta", "bali", "denpasar"],
  vn: ["vietnam", "viet nam", "hanoi", "ho chi minh"],
  jp: ["japan", "tokyo", "osaka", "kyoto", "yokohama"],
  kr: ["south korea", "korea", "seoul", "busan"],
  tw: ["taiwan", "taipei", "hsinchu"],
  hk: ["hong kong", "kowloon"],
  cn: ["china", "shanghai", "beijing", "shenzhen", "guangzhou", "foshan", "hangzhou"],
  sa: ["saudi arabia", "riyadh", "jeddah", "dammam", "neom"],
  qa: ["qatar", "doha"],
  eg: ["egypt", "cairo", "giza", "alexandria, eg"],
  il: ["israel", "tel aviv", "herzliya", "jerusalem"],
  tr: ["turkey", "türkiye", "istanbul", "ankara"],
  za: ["south africa", "johannesburg", "cape town", "durban"],
  ke: ["kenya", "nairobi"],
  nz: ["new zealand", "auckland", "wellington"],
  es: ["spain", "españa", "madrid", "barcelona", "valencia", "malaga"],
  it: ["italy", "italia", "milan", "milano", "rome", "roma", "turin"],
  pl: ["poland", "polska", "warsaw", "warszawa", "krakow", "kraków", "wroclaw", "gdansk"],
  pt: ["portugal", "lisbon", "lisboa", "porto"],
  ch: ["switzerland", "zurich", "zürich", "geneva", "lausanne", "basel"],
  dk: ["denmark", "copenhagen", "københavn", "aarhus"],
  no: ["norway", "oslo", "bergen"],
  fi: ["finland", "helsinki", "espoo", "tampere"],
  be: ["belgium", "brussels", "bruxelles", "antwerp", "ghent"],
  at: ["austria", "vienna", "wien", "graz", "linz"],
  cz: ["czech", "czechia", "prague", "praha", "brno"],
  ro: ["romania", "bucharest", "bucuresti", "cluj", "timisoara"],
  br: ["brazil", "brasil", "sao paulo", "são paulo", "rio de janeiro", "campinas", "belo horizonte"],
  mx: ["mexico", "méxico", "mexico city", "guadalajara", "monterrey"],
  ar: ["argentina", "buenos aires", "cordoba, ar"],
  cl: ["chile", "santiago, chile"],
  co: ["colombia", "bogota", "bogotá", "medellin", "medellín"],
};

export function matchesCountry(location: string, country: Country): boolean {
  const l = location.toLowerCase();
  if (country === "in") return looksIndian(location);
  if (country === "us") return US_HINTS.some((h) => l.includes(h)) || US_STATE_RE.test(location);
  return COUNTRY_HINTS[country].some((h) => h.startsWith(",") ? l.endsWith(h) || l.includes(h + ";") : l.includes(h));
}

export const ALL_COUNTRIES: Country[] = [
  "in", "us", "gb", "de", "nl", "ae", "ca", "sg", "au", "se", "fr", "ie",
  "th", "my", "ph", "id", "vn", "jp", "kr", "tw", "hk", "cn",
  "sa", "qa", "eg", "il", "tr", "za", "ke", "nz",
  "es", "it", "pl", "pt", "ch", "dk", "no", "fi", "be", "at", "cz", "ro",
  "br", "mx", "ar", "cl", "co",
];

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
