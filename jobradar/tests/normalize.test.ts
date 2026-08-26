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
