const MAX_DESC = 3000;

/** Strip HTML tags/entities into readable plain text. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();
  return text ? text.slice(0, MAX_DESC) : null;
}

export function toIso(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Key for tracking the same "job slot" across reposts (id changes, role doesn't). */
export function slotKey(source: string, companyToken: string, title: string, location: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
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
