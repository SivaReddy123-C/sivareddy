# ATS Parse-Fidelity Proof

Generated 2026-08-26 by `app/scripts/ats-check.mjs` - reproducible by anyone.

**Claim tested:** text extracts from JobRadar-generated resume PDFs completely
and in correct reading order. Extraction is the first thing every ATS parser
does; a resume that extracts wrong becomes unsearchable.

**Method:** for each of the 6 templates, render a sample resume, print to
PDF exactly as a user does, extract text with pdf.js, then assert all
19 resume facts (name, contact, links, every bullet, dates, scores,
skills) are present verbatim and the section headings appear in configured order.

| Template | Fields extracted | Reading order | Result |
|---|---|---|---|
| classic | 19/19 | correct | PASS |
| compact | 19/19 | correct | PASS |
| modern | 19/19 | correct | PASS |
| elegant | 19/19 | correct | PASS |
| mono | 19/19 | correct | PASS |
| minimal | 19/19 | correct | PASS |

**Overall: ALL TEMPLATES PASS**

What this does NOT claim: no tool can guarantee a human recruiter reads your
resume, and ATSs do not auto-reject on formatting (that is a myth) - clean
parsing makes you *findable* in recruiter search, nothing more, nothing less.

Reproduce: `cd app && npm i -D playwright pdfjs-dist && npm run build && npx vite preview --port 4177 & node scripts/ats-check.mjs`
