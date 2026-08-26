/**
 * Resume import. Two stages, both under the user's control:
 *  1. Extract text from the uploaded PDF entirely in the browser (pdf.js) -
 *     the file never leaves the machine. The raw extraction is shown as an
 *     "ATS X-ray": exactly what parsing software sees, in the order it sees it.
 *  2. Optionally parse that text into the structured resume with the user's
 *     own Anthropic key (same BYO-key channel as the writing suggestions),
 *     previewed before anything is applied.
 */
import { uid } from "./storage.js";
import type { ResumeData } from "./types.js";

export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Position-aware join: spaces only at real gaps or line breaks, so
    // ligature/style splits don't shatter words - same logic as our ATS proof.
    let lastEnd: number | null = null;
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      if (lastY !== null && Math.abs(y - lastY) > 2) text += "\n";
      else if (lastEnd !== null && x - lastEnd > 1.5) text += " ";
      text += item.str;
      lastEnd = x + (item.width ?? 0);
      lastY = y;
    }
    text += "\n";
  }
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Shape the AI is asked to produce - a subset of ResumeData, no ids. */
export interface ParsedResume {
  basics?: {
    name?: string; headline?: string; email?: string; phone?: string; location?: string;
    links?: { label?: string; url?: string }[];
  };
  summary?: string;
  experience?: { company?: string; role?: string; location?: string; start?: string; end?: string; bullets?: string[] }[];
  projects?: { name?: string; link?: string; bullets?: string[] }[];
  education?: { school?: string; degree?: string; start?: string; end?: string; score?: string; details?: string }[];
  skills?: { group?: string; items?: string }[];
}

/** Merge a parsed resume over an existing one; template/settings are kept. */
export function applyParsed(current: ResumeData, p: ParsedResume): ResumeData {
  const s = (v: string | undefined) => (v ?? "").trim();
  return {
    ...current,
    basics: {
      name: s(p.basics?.name) || current.basics.name,
      headline: s(p.basics?.headline),
      email: s(p.basics?.email) || current.basics.email,
      phone: s(p.basics?.phone),
      location: s(p.basics?.location),
      links: (p.basics?.links ?? [])
        .filter((l) => s(l.url))
        .map((l) => ({ label: s(l.label) || "Link", url: s(l.url) })),
    },
    summary: s(p.summary),
    experience: (p.experience ?? []).map((e) => ({
      id: uid(), company: s(e.company), role: s(e.role), location: s(e.location),
      start: s(e.start), end: s(e.end),
      bullets: (e.bullets ?? []).map((b) => b.trim()).filter(Boolean),
    })),
    projects: (p.projects ?? []).map((e) => ({
      id: uid(), name: s(e.name), link: s(e.link),
      bullets: (e.bullets ?? []).map((b) => b.trim()).filter(Boolean),
    })),
    education: (p.education ?? []).map((e) => ({
      id: uid(), school: s(e.school), degree: s(e.degree), start: s(e.start),
      end: s(e.end), score: s(e.score), details: s(e.details),
    })),
    skills: (p.skills ?? [])
      .filter((g) => s(g.items))
      .map((g) => ({ id: uid(), group: s(g.group), items: s(g.items) })),
  };
}

export function parsedSummary(p: ParsedResume): string {
  return [
    p.basics?.name && `Name: ${p.basics.name}`,
    p.basics?.email && `Email: ${p.basics.email}`,
    `${p.experience?.length ?? 0} experience entries`,
    `${p.projects?.length ?? 0} projects`,
    `${p.education?.length ?? 0} education entries`,
    `${p.skills?.length ?? 0} skill groups`,
  ].filter(Boolean).join(" · ");
}
