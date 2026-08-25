import type { Application } from "./types.js";

const DAY = 24 * 60 * 60 * 1000;
/** After this many days with no reply, we call it what it is. */
export const GHOSTED_AFTER_DAYS = 21;

export function daysSince(iso: string, now = new Date()): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);
}

export function isLikelyGhosted(app: Application, now = new Date()): boolean {
  return app.status === "applied" && daysSince(app.appliedAt, now) >= GHOSTED_AFTER_DAYS;
}

export interface TrackerStats {
  total: number;
  replied: number;       // got any human response (replied or further)
  interviews: number;    // reached interview or further
  offers: number;        // offer or accepted
  accepted: number;
  rejected: number;
  likelyGhosted: number;
  replyRate: number | null; // null when total is 0 - never fake a 0%
}

const REPLIED_OR_BETTER = new Set(["replied", "interview", "offer", "accepted", "rejected"]);
const INTERVIEW_OR_BETTER = new Set(["interview", "offer", "accepted"]);

export function computeStats(apps: Application[], now = new Date()): TrackerStats {
  const total = apps.length;
  const replied = apps.filter((a) => REPLIED_OR_BETTER.has(a.status)).length;
  const interviews = apps.filter((a) => INTERVIEW_OR_BETTER.has(a.status)).length;
  const offers = apps.filter((a) => a.status === "offer" || a.status === "accepted").length;
  const accepted = apps.filter((a) => a.status === "accepted").length;
  const rejected = apps.filter((a) => a.status === "rejected").length;
  const likelyGhosted = apps.filter((a) => isLikelyGhosted(a, now)).length;
  return {
    total, replied, interviews, offers, accepted, rejected, likelyGhosted,
    replyRate: total ? Math.round((replied / total) * 100) : null,
  };
}
