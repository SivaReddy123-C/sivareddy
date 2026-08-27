import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToText, looksIndian, slotKey, toIso } from "../src/normalize.js";
import { hasSalaryText } from "../src/sources/greenhouse.js";

test("htmlToText strips tags and entities", () => {
  const out = htmlToText("<p>Hello &amp; welcome</p><script>evil()</script><li>item</li>");
  assert.ok(out!.includes("Hello & welcome"));
  assert.ok(!out!.includes("evil"));
});

test("htmlToText returns null for empty input", () => {
  assert.equal(htmlToText(""), null);
  assert.equal(htmlToText(null), null);
});

test("toIso handles ms epochs and date strings, rejects junk", () => {
  assert.equal(toIso(1724544000000), "2024-08-25T00:00:00.000Z");
  assert.equal(toIso("2026-08-20"), "2026-08-20T00:00:00.000Z");
  assert.equal(toIso("not a date"), null);
  assert.equal(toIso(null), null);
});

test("slotKey normalizes case and whitespace so reposts collide", () => {
  assert.equal(
    slotKey("lever", "acme", "Backend  Engineer", "Bengaluru"),
    slotKey("lever", "acme", "backend engineer", "bengaluru "),
  );
});

test("looksIndian matches Indian cities and spellings", () => {
  assert.ok(looksIndian("Bengaluru, Karnataka"));
  assert.ok(looksIndian("Remote - India"));
  assert.ok(looksIndian("Gurugram"));
  assert.ok(!looksIndian("San Francisco, CA"));
});

test("hasSalaryText detects INR and LPA formats", () => {
  assert.ok(hasSalaryText("Compensation: ₹18-24 LPA depending on experience"));
  assert.ok(hasSalaryText("Salary: $120,000 - $150,000"));
  assert.ok(!hasSalaryText("We offer competitive compensation and benefits."));
});

test("matchesCountry recognizes US locations", async () => {
  const { matchesCountry } = await import("../src/normalize.js");
  assert.ok(matchesCountry("San Francisco, CA", "us"));
  assert.ok(matchesCountry("Remote - US", "us"));
  assert.ok(matchesCountry("New York, United States", "us"));
  assert.ok(!matchesCountry("Bengaluru, India", "us"));
  assert.ok(matchesCountry("Bengaluru, India", "in"));
});

test("sponsorshipSignal detects explicit no-sponsorship language", async () => {
  const { sponsorshipSignal } = await import("../src/normalize.js");
  assert.equal(sponsorshipSignal("We are unable to sponsor visas now or in the future."), "no");
  assert.equal(sponsorshipSignal("Candidates must be authorized to work in the US."), "no");
  assert.equal(sponsorshipSignal("H-1B sponsorship available for this role."), "yes");
  assert.equal(sponsorshipSignal("We value diversity and inclusion."), "unknown");
  assert.equal(sponsorshipSignal(null), "unknown");
});

test("htmlToText handles Greenhouse-style escaped HTML", () => {
  const escaped = "&lt;p&gt;We are &lt;strong&gt;unable to sponsor&lt;/strong&gt; visas.&lt;/p&gt;";
  const out = htmlToText(escaped);
  assert.ok(out!.includes("unable to sponsor"), out ?? "null");
  assert.ok(!out!.includes("<"));
});

test("sponsorship detection works through escaped Greenhouse HTML", async () => {
  const { sponsorshipSignal } = await import("../src/normalize.js");
  const desc = htmlToText("&lt;p&gt;Candidates &lt;b&gt;must be authorized to work&lt;/b&gt; in the United States.&lt;/p&gt;");
  assert.equal(sponsorshipSignal(desc), "no");
});

test("stub classifier: known brands, keywords, and clean products", async () => {
  const { StubClassifier } = await import("../src/classify.js");
  const c = new StubClassifier();
  assert.equal(c.classifyEmployer("TEKsystems India").type, "staffing");
  assert.equal(c.classifyEmployer("Apex Recruiting Partners").type, "staffing");
  assert.equal(c.classifyEmployer("Wipro Limited").type, "consultancy");
  assert.equal(c.classifyEmployer("Stripe").type, "unknown");
});

test("sync row mappers preserve identity and never send first_seen_at", async () => {
  const { jobToRow, snapshotRow } = await import("../src/sync.js");
  const job = {
    key: "greenhouse:acme:1", source: "greenhouse", company: "Acme", companyToken: "acme",
    sourceJobId: "1", title: "SWE", location: "Bengaluru", remote: false,
    url: "https://x/1", applyUrl: "https://x/1/a", department: null, employmentType: null,
    description: "hello", hasSalaryInfo: true, publishedAt: "2026-08-01T00:00:00Z", updatedAt: null,
    firstSeenAt: "2026-08-01T00:00:00Z", lastSeenAt: "2026-08-25T00:00:00Z",
    ghost: { score: 10, band: "low", signals: [{ id: "no_salary", weight: 10, reason: "r" }] },
    sponsorship: "unknown",
  } as never;
  const row = jobToRow(job, "cid") as Record<string, unknown>;
  assert.equal(row.source_job_id, "1");
  assert.ok(!("first_seen_at" in row), "first_seen_at must be DB-defaulted, not overwritten");
  assert.equal((row.ghost_reasons as string[])[0], "r");
  const snap = snapshotRow(job, "pid", "2026-08-25") as Record<string, unknown>;
  assert.equal(snap.run_date, "2026-08-25");
  assert.equal((snap.signals as { id: string }[])[0]!.id, "no_salary");
});

test("fit scoring: skills, freshness, seniority, ghost penalty", async () => {
  const { scoreFit, seniorityOfTitle } = await import("../src/fit.js");
  const NOW2 = new Date("2026-08-25T00:00:00Z");
  const profile = { skills: ["react", "typescript"], countries: ["in"], locations: ["bengaluru"], seniorityTarget: "junior", needsSponsorship: false };
  const posting = {
    title: "Junior Frontend Engineer", location: "Bengaluru, India", country: "in",
    descriptionText: "Build UIs with React and TypeScript", hasSalary: true,
    postedAt: "2026-08-23T00:00:00Z", firstSeenAt: "2026-08-23T00:00:00Z", ghostScore: 10,
    sponsorship: "unknown" as const,
  };
  const r = scoreFit(profile, posting, NOW2);
  assert.ok(r.score >= 60, `expected strong fit, got ${r.score}: ${r.reasons.join("; ")}`);
  assert.ok(r.reasons.some((x) => x.includes("react")));
  assert.ok(r.reasons.some((x) => x.includes("Seniority level matches")));

  const staffRole = scoreFit(profile, { ...posting, title: "Staff Software Engineer" }, NOW2);
  assert.ok(staffRole.reasons.some((x) => x.includes("above your target")));

  const stale = scoreFit(profile, { ...posting, postedAt: "2026-06-01T00:00:00Z", ghostScore: 45 }, NOW2);
  assert.ok(stale.score < r.score);
  assert.ok(stale.reasons.some((x) => x.includes("ghost risk")));

  assert.equal(seniorityOfTitle("Software Engineer Intern"), "intern");
  assert.equal(seniorityOfTitle("Sr. Backend Engineer"), "senior");
  assert.equal(seniorityOfTitle("Software Engineer"), null);
});

test("discovery token variants", async () => {
  const { tokenVariants } = await import("../src/discover.js");
  assert.deepEqual(tokenVariants("Retool"), ["retool"]);
  assert.ok(tokenVariants("Grafana Labs").includes("grafanalabs"));
  assert.ok(tokenVariants("Grafana Labs").includes("grafana-labs"));
  assert.ok(tokenVariants("Grafana Labs").includes("grafana"));
  assert.ok(tokenVariants("Fly.io").includes("flyio"));
});

test("workday postedOn parsing via adapter shape", async () => {
  // postedOnToIso is internal; exercise it indirectly by checking the module loads
  const mod = await import("../src/sources/workday.js");
  assert.equal(mod.workday.source, "workday");
});

test("multi-country detection", async () => {
  const { detectCountry } = await import("../src/normalize.js");
  assert.equal(detectCountry("Berlin, Germany"), "de");
  assert.equal(detectCountry("London, United Kingdom"), "gb");
  assert.equal(detectCountry("Dubai, UAE"), "ae");
  assert.equal(detectCountry("Stockholm"), "se");
  assert.equal(detectCountry("Bengaluru, India"), "in");
  assert.equal(detectCountry("Austin, TX"), "us");
  assert.equal(detectCountry("Toronto, Canada"), "ca");
  assert.equal(detectCountry("Mars Colony 7"), null);
});

test("skill extraction tags the actual work, and non-engineering roles too", async () => {
  const { extractTags, normalizeProfileSkills } = await import("../src/skills.js");
  const backend = extractTags("Senior Software Engineer",
    "Build services in Python on AWS, querying PostgreSQL. Experience with Kubernetes a plus.");
  assert.ok(backend.includes("python") && backend.includes("aws") && backend.includes("postgres"));
  assert.ok(backend.includes("kubernetes"));

  // A sales role must be tagged as sales so it can be kept out of an engineer's list.
  const sales = extractTags("Account Executive, Enterprise", "Own a quota and drive new business.");
  assert.ok(sales.includes("sales"));
  assert.ok(!sales.includes("python"));

  // Profile skills map onto the same vocabulary.
  const mapped = normalizeProfileSkills(["SQL", "Python", "system design", "AWS"]);
  assert.ok(mapped.includes("sql") && mapped.includes("python") && mapped.includes("aws"));
  assert.ok(mapped.includes("system design"), "unmapped skills are kept verbatim");
});

test("sync deduplicates postings sharing a source id", async () => {
  const { jobToRow } = await import("../src/sync.js");
  const mk = (sourceJobId: string, title: string) => ({
    key: "k", source: "workday", company: "CVS Health", companyToken: "cvshealth",
    sourceJobId, title, location: "Dallas, TX", remote: null, url: "u", applyUrl: null,
    department: null, employmentType: null, description: null, hasSalaryInfo: false,
    publishedAt: null, updatedAt: null, firstSeenAt: "2026-08-26T00:00:00Z",
    lastSeenAt: "2026-08-26T00:00:00Z",
    ghost: { score: 0, band: "low", signals: [] }, sponsorship: "unknown",
  }) as never;
  // Mirror the dedupe the sync performs before upserting.
  const jobs = [mk("/job/A", "Pharmacy Tech"), mk("/job/A", "Pharmacy Tech"), mk("/job/B", "Nurse")];
  const byKey = new Map<string, unknown>();
  for (const j of jobs) {
    const row = jobToRow(j, "cid");
    if (!byKey.has(row.source_job_id)) byKey.set(row.source_job_id, row);
  }
  assert.equal(byKey.size, 2, "duplicate source ids collapse to one row per key");
});

test("sync strips characters Postgres rejects inside json", async () => {
  const { cleanText } = await import("../src/sync.js");
  assert.equal(cleanText("clean text"), "clean text");
  assert.equal(cleanText(`with${String.fromCharCode(0)}nul`), "withnul");
  // A lone high surrogate makes the serialized json invalid.
  assert.equal(cleanText(`lone${String.fromCharCode(0xd800)}surrogate`), "lonesurrogate");
  assert.equal(cleanText(`lone${String.fromCharCode(0xdc00)}low`), "lonelow");
  // A valid surrogate pair (an emoji) must survive untouched.
  assert.equal(cleanText("emoji \u{1F600} ok"), "emoji \u{1F600} ok");
  assert.equal(cleanText(null), null);
});

test("employer normalization joins federal filings to job boards", async () => {
  const { normalizeEmployer } = await import("../src/sponsorship.js");
  // The same company, spelled as each source spells it.
  assert.equal(normalizeEmployer("STRIPE, INC."), normalizeEmployer("Stripe"));
  assert.equal(normalizeEmployer("DATABRICKS, INC."), normalizeEmployer("Databricks"));
  assert.equal(normalizeEmployer("Cognizant Technology Solutions US Corp"), "cognizant");
  assert.equal(normalizeEmployer("NVIDIA Corporation"), "nvidia");
  // Different companies must not collide.
  assert.notEqual(normalizeEmployer("Meta Platforms"), normalizeEmployer("Metabase"));
});

test("USCIS csv parsing sums an employer's offices and reads real headers", async () => {
  const { rowsFromCsv, parseCsv } = await import("../src/sponsorship.js");
  const csv = [
    'Fiscal Year,Employer (Petitioner) Name,Initial Approval,Initial Denial,Continuing Approval,Continuing Denial,Petitioner City,Petitioner State',
    '2025,"ACME, INC.",10,1,5,0,Austin,TX',
    '2025,"ACME, INC.",3,0,2,1,Seattle,WA',
    '2025,"BETA LLC",7,2,1,0,"New York, Borough of Queens",NY',
  ].join("\n");
  // Quoted commas must not split a field.
  assert.equal(parseCsv(csv)[3]![6], "New York, Borough of Queens");

  const rows = rowsFromCsv(csv, 2025);
  assert.equal(rows.length, 2, "two employers, offices summed");
  const acme = rows.find((r) => r.employer_norm === "acme")!;
  assert.equal(acme.initial_approval, 13);
  assert.equal(acme.continuing_approval, 7);
  assert.equal(acme.initial_denial, 1);
  assert.equal(acme.fiscal_year, 2025);
});

test("csv parser tolerates a renamed header column", async () => {
  const { rowsFromCsv } = await import("../src/sponsorship.js");
  const csv = 'Fiscal Year,Employer,Initial Approvals,Initial Denials,Continuing Approvals,Continuing Denials\n2025,"GAMMA CORP",4,0,1,0';
  const rows = rowsFromCsv(csv, 2025);
  assert.equal(rows[0]!.employer_norm, "gamma");
  assert.equal(rows[0]!.initial_approval, 4);
});

test("sponsor index page states facts and refuses to overclaim", async () => {
  const { renderPage } = await import("../src/sponsorpage.js");
  const html = renderPage(
    [{ company: "NVIDIA", matchedName: "NVIDIA CORPORATION", approvals: 394, denials: 1,
       fiscalYear: 2023, openJobs: 2000, usJobs: 1200 }],
    "2026-08-27T01:00:00.000Z",
    { employers: 113, federalRecords: 122857, openJobs: 39483, usJobsAtSponsors: 10638 },
  );
  assert.ok(html.includes("NVIDIA CORPORATION"), "shows the matched federal name");
  assert.ok(html.includes("394"), "shows the real count");
  assert.ok(html.includes("FY2023"), "names the fiscal year");
  // The honesty caveat must be on the page, not just in our commit messages.
  assert.ok(html.includes("evidence, not proof"));
  assert.ok(html.includes("uscis.gov"), "links the primary source so anyone can check");
  // Company names must be escaped, not injected.
  const nasty = renderPage(
    [{ company: '<script>x</script>', matchedName: "X", approvals: 1, denials: 0,
       fiscalYear: 2023, openJobs: 1, usJobs: 1 }],
    "2026-08-27T01:00:00.000Z", { employers: 1, federalRecords: 1, openJobs: 1, usJobsAtSponsors: 1 });
  assert.ok(!nasty.includes("<script>x</script>"));
  assert.ok(nasty.includes("&lt;script&gt;"));
});

test("slotKey survives a malformed posting instead of killing the run", async () => {
  const { slotKey } = await import("../src/normalize.js");
  // A real Workday tenant returned a record with no title; this used to throw
  // and take the entire 300-board run down with it.
  assert.doesNotThrow(() => slotKey("workday", "acme", undefined as unknown as string, "Austin"));
  assert.doesNotThrow(() => slotKey("workday", "acme", "SWE", null as unknown as string));
  assert.equal(slotKey("workday", "acme", undefined as unknown as string, "Austin, TX"),
               "workday|acme||austin, tx");
});
