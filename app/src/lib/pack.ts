import type { AnswerEntry, ResumeData } from "./types.js";

/**
 * The "application pack": everything a form asks for, as clean text ready to
 * paste. The quick-win version of assisted apply - the extension automates the
 * same data later.
 */
export function buildApplicationPack(resume: ResumeData, answers: AnswerEntry[]): string {
  const b = resume.basics;
  const lines: string[] = [];
  if (b.name) lines.push(b.name);
  if (b.headline) lines.push(b.headline);
  const contact = [b.email, b.phone, b.location].filter(Boolean).join(" · ");
  if (contact) lines.push(contact);
  for (const l of b.links.filter((x) => x.url)) {
    lines.push(`${l.label || "Link"}: ${l.url}`);
  }

  const filled = answers.filter((a) => a.value.trim());
  if (filled.length > 0) {
    lines.push("");
    for (const a of filled) lines.push(`${a.label} ${a.value}`);
  }

  const skills = resume.skills.filter((s) => s.items.trim());
  if (skills.length > 0) {
    lines.push("");
    for (const s of skills) lines.push(`${s.group ? s.group + ": " : ""}${s.items}`);
  }
  return lines.join("\n");
}
