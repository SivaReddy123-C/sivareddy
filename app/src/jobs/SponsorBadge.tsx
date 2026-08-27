import type { FeedJob } from "./feed.js";

/**
 * Sponsorship shown as fact, not inference: the number of H-1B petitions this
 * employer filed, from USCIS federal records, with the fiscal year attached so
 * the reader can judge how current it is. Absence is stated as absence.
 */
export function SponsorBadge({ job }: { job: FeedJob }) {
  if (job.country !== "us") return null; // H-1B is a US concern only
  const s = job.sponsor;
  if (s && s.approvals > 0) {
    return (
      <span className="tag tag-sponsor" title={`USCIS records for ${s.name}: ${s.approvals} H-1B petitions approved, ${s.denials} denied in FY${s.fy}`}>
        sponsors H-1B · {s.approvals.toLocaleString()} approved FY{s.fy}
      </span>
    );
  }
  return (
    <span className="tag tag-nofiling" title="No H-1B petitions found for this employer in the USCIS records we hold. That is evidence, not proof - a company can sponsor without recent filings.">
      no H-1B filings on record
    </span>
  );
}
