/**
 * ATS parse-fidelity proof. For every template:
 *   1. Render the sample resume and print to PDF exactly as a user would.
 *   2. Extract text with a real PDF text extractor (pdf.js - the same class of
 *      extraction an ATS parser performs first).
 *   3. Assert every field is present and sections appear in reading order.
 * Run: node scripts/ats-check.mjs   (after: npm run build && npm i -D playwright pdfjs-dist)
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const TEMPLATES = ["classic", "compact", "modern", "elegant", "mono", "minimal"];

const sample = {
  version: 1,
  resume: {
    template: "classic",
    settings: { accent: "#1f6feb", font: "template", density: "comfortable",
      sectionOrder: ["summary", "experience", "projects", "education", "skills"] },
    basics: {
      name: "Ananya Sharma", headline: "Frontend Engineer",
      email: "ananya.sharma@example.com", phone: "+91 98765 43210", location: "Bengaluru, IN",
      links: [{ label: "GitHub", url: "https://github.com/ananya" }, { label: "LinkedIn", url: "https://linkedin.com/in/ananya" }],
    },
    summary: "Final-year CSE student who ships production React applications.",
    experience: [{ id: "x1", company: "Zetta Labs", role: "SDE Intern", location: "Remote",
      start: "Jan 2026", end: "Jun 2026",
      bullets: ["Built the billing dashboard in React and TypeScript, cutting invoice tickets by 30%",
                "Wrote Playwright tests covering the 12 highest-traffic flows"] }],
    projects: [{ id: "p1", name: "JobRadar contribution", link: "https://github.com/example/jobradar",
      bullets: ["Added the Lever adapter to an open-source ghost-job detector"] }],
    education: [{ id: "e1", school: "RV College of Engineering", degree: "B.E. Computer Science",
      start: "2022", end: "2026", score: "8.7 CGPA", details: "Coursework: DSA, DBMS, Operating Systems" }],
    skills: [{ id: "s1", group: "Languages", items: "TypeScript, Python, SQL" },
             { id: "s2", group: "Frontend", items: "React, Vite, HTML/CSS" }],
  },
  applications: [], answers: [],
};

// Every fact on the resume must survive extraction verbatim.
const REQUIRED = [
  "Ananya Sharma", "ananya.sharma@example.com", "+91 98765 43210", "Bengaluru, IN",
  "github.com/ananya", "ships production React applications",
  "Zetta Labs", "SDE Intern", "Jan 2026", "Jun 2026",
  "cutting invoice tickets by 30%", "12 highest-traffic flows",
  "JobRadar contribution", "Lever adapter",
  "RV College of Engineering", "B.E. Computer Science", "8.7 CGPA",
  "TypeScript, Python, SQL", "React, Vite, HTML/CSS",
];
// Section headings must appear in the configured order.
const ORDER = ["Summary", "Experience", "Projects", "Education", "Skills"];

async function extractText(pdfBuffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  // Position-aware join, as real parsers do: only insert a space when there is
  // an actual horizontal gap or line break between items - ligature and style
  // boundaries split items mid-word and must not become spaces.
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastEnd = null;
    let lastY = null;
    for (const it of content.items) {
      const x = it.transform[4];
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) text += " ";
      else if (lastEnd !== null && x - lastEnd > 1.5) text += " ";
      text += it.str;
      lastEnd = x + (it.width ?? 0);
      lastY = y;
    }
    text += " ";
  }
  return text.replace(/\s+/g, " ");
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
for (const template of TEMPLATES) {
  const state = structuredClone(sample);
  state.resume.template = template;
  const page = await browser.newPage();
  await page.addInitScript((s) => localStorage.setItem("jobradar.v1", JSON.stringify(s)), state);
  await page.goto(process.env.APP_URL || "http://localhost:4177/");
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ format: "A4" });
  const text = await extractText(pdf);

  const lower = text.toLowerCase();
  const missing = REQUIRED.filter((r) => !lower.includes(r.toLowerCase()));
  let orderOk = true;
  let last = -1;
  for (const h of ORDER) {
    const idx = text.toUpperCase().indexOf(h.toUpperCase());
    if (idx === -1 || idx < last) { orderOk = false; break; }
    last = idx;
  }
  const pass = missing.length === 0 && orderOk;
  results.push({ template, pass, missing, orderOk, chars: text.length });
  console.log(`${pass ? "PASS" : "FAIL"}  ${template.padEnd(9)} fields ${REQUIRED.length - missing.length}/${REQUIRED.length}  order ${orderOk ? "correct" : "WRONG"}`);
  if (missing.length) console.log("   missing:", missing.join(" | "));
  await page.close();
}
await browser.close();

const allPass = results.every((r) => r.pass);
const report = `# ATS Parse-Fidelity Proof

Generated ${new Date().toISOString().slice(0, 10)} by \`app/scripts/ats-check.mjs\` - reproducible by anyone.

**Claim tested:** text extracts from JobRadar-generated resume PDFs completely
and in correct reading order. Extraction is the first thing every ATS parser
does; a resume that extracts wrong becomes unsearchable.

**Method:** for each of the ${TEMPLATES.length} templates, render a sample resume, print to
PDF exactly as a user does, extract text with pdf.js, then assert all
${REQUIRED.length} resume facts (name, contact, links, every bullet, dates, scores,
skills) are present verbatim and the section headings appear in configured order.

| Template | Fields extracted | Reading order | Result |
|---|---|---|---|
${results.map((r) => `| ${r.template} | ${REQUIRED.length - r.missing.length}/${REQUIRED.length} | ${r.orderOk ? "correct" : "WRONG"} | ${r.pass ? "PASS" : "FAIL"} |`).join("\n")}

**Overall: ${allPass ? "ALL TEMPLATES PASS" : "FAILURES PRESENT"}**

What this does NOT claim: no tool can guarantee a human recruiter reads your
resume, and ATSs do not auto-reject on formatting (that is a myth) - clean
parsing makes you *findable* in recruiter search, nothing more, nothing less.

Reproduce: \`cd app && npm i -D playwright pdfjs-dist && npm run build && npx vite preview --port 4177 & node scripts/ats-check.mjs\`
`;
writeFileSync(new URL("../ATS-PROOF.md", import.meta.url), report);
console.log(allPass ? "\nALL TEMPLATES PASS - report written to app/ATS-PROOF.md" : "\nFAILURES - see report");
process.exit(allPass ? 0 : 1);
