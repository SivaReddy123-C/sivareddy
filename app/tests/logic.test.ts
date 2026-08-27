import assert from "node:assert/strict";
import { test } from "node:test";
import { computeStats, isLikelyGhosted } from "../src/lib/stats.js";
import { emptyState, exportJson, importJson, normalizeState } from "../src/lib/storage.js";
import type { Application } from "../src/lib/types.js";

const NOW = new Date("2026-08-25T00:00:00Z");

function app(overrides: Partial<Application>): Application {
  return {
    id: "x", company: "Acme", title: "SWE", url: "", location: "", source: "",
    appliedAt: "2026-08-20T00:00:00Z", status: "applied",
    statusChangedAt: "2026-08-20T00:00:00Z", notes: "",
    ...overrides,
  };
}

test("ghosted only after threshold and only while still 'applied'", () => {
  assert.ok(!isLikelyGhosted(app({ appliedAt: "2026-08-10T00:00:00Z" }), NOW));
  assert.ok(isLikelyGhosted(app({ appliedAt: "2026-08-01T00:00:00Z" }), NOW));
  assert.ok(!isLikelyGhosted(app({ appliedAt: "2026-08-01T00:00:00Z", status: "rejected" }), NOW));
});

test("stats: rejections count as replies (honest reply rate), null rate when empty", () => {
  const s = computeStats(
    [app({ status: "rejected" }), app({ status: "interview" }), app({}), app({})],
    NOW,
  );
  assert.equal(s.total, 4);
  assert.equal(s.replied, 2);
  assert.equal(s.replyRate, 50);
  assert.equal(s.interviews, 1);
  assert.equal(computeStats([], NOW).replyRate, null);
});

test("export/import round-trips and survives junk", () => {
  const state = emptyState();
  state.applications.push(app({}));
  const back = importJson(exportJson(state));
  assert.equal(back.applications.length, 1);
  assert.equal(back.applications[0]!.company, "Acme");
  const junk = normalizeState({ resume: { basics: { name: "S" } }, applications: "nope" });
  assert.equal(junk.resume.basics.name, "S");
  assert.deepEqual(junk.applications, []);
  assert.equal(junk.resume.template, "classic");
});

test("normalizeSectionOrder keeps valid order, drops junk, appends missing", async () => {
  const { normalizeSectionOrder } = await import("../src/lib/storage.js");
  assert.deepEqual(
    normalizeSectionOrder(["education", "bogus", "summary"]),
    ["education", "summary", "experience", "projects", "skills"],
  );
  assert.deepEqual(
    normalizeSectionOrder(undefined),
    ["summary", "experience", "projects", "education", "skills"],
  );
});

test("old exports without settings gain defaults on import", () => {
  const legacy = { resume: { basics: { name: "S" }, template: "compact" }, applications: [] };
  const state = normalizeState(legacy);
  assert.equal(state.resume.settings.accent, "#1f6feb");
  assert.equal(state.resume.settings.sectionOrder.length, 5);
});

test("writing check flags weak openers and missing numbers", async () => {
  const { checkBullet, checkSummary } = await import("../src/lib/writecheck.js");
  const weak = checkBullet("Responsible for testing the website");
  assert.ok(weak.some((h) => h.includes("Starts with")));
  assert.ok(weak.some((h) => h.includes("number")));
  // Weak-opener hint outranks the metric nag - only the first hint is shown.
  assert.ok(weak[0]!.includes("Starts with"));
  assert.deepEqual(checkBullet("Reduced build time 40% by caching dependencies"), []);
  // No metric nag on bullets carrying a placeholder the writer will fill...
  assert.ok(!checkBullet("Shipped [X] releases across the enterprise system").some((h) => h.includes("number")));
  // ...nor on long bullets, where there is no room for one anyway.
  const long = "Built and operated a multi-tenant platform " + "x".repeat(120);
  assert.ok(!checkBullet(long).some((h) => h.includes("number")));
  assert.ok(checkSummary("I am a passionate hardworking team player").length > 0);
});

test("AI suggestion parser tolerates fenced output, rejects junk", async () => {
  const { parseSuggestions } = await import("../src/lib/ai.js");
  assert.deepEqual(parseSuggestions('["a", "b"]'), ["a", "b"]);
  assert.deepEqual(parseSuggestions('```json\n["x","y"]\n```'), ["x", "y"]);
  assert.throws(() => parseSuggestions("sorry, no"));
});

test("job filters: country, ghost, sponsorship, search, sort", async () => {
  const { applyFilters, defaultFilters } = await import("../src/jobs/feed.js");
  const mk = (over: Record<string, unknown>) => ({
    key: "k", company: "Acme", title: "SWE", location: "Bengaluru", country: "in",
    url: "u", source: "greenhouse", publishedAt: "2026-08-01T00:00:00Z",
    firstSeenAt: "2026-08-01T00:00:00Z",
    ghost: { score: 10, band: "low", reasons: [] }, sponsorship: "unknown", hasSalaryInfo: false,
    ...over,
  }) as never;
  const jobs = [
    mk({ key: "1", country: "us", ghost: { score: 80, band: "critical", reasons: [] } }),
    mk({ key: "2", country: "us", sponsorship: "no" }),
    mk({ key: "3", company: "Stripe", title: "Backend Engineer" }),
  ];
  const f = defaultFilters();
  assert.equal(applyFilters(jobs, { ...f, country: "us" }).length, 2);
  assert.equal(applyFilters(jobs, { ...f, hideHighGhost: true }).length, 2);
  assert.equal(applyFilters(jobs, { ...f, sponsorshipOnly: true }).length, 2);
  assert.equal(applyFilters(jobs, { ...f, q: "backend" })[0]!.key, "3");
  assert.equal(applyFilters(jobs, { ...f, sort: "ghost" })[2]!.key, "1");
});

test("application pack: contact block, filled answers only, skills", async () => {
  const { buildApplicationPack } = await import("../src/lib/pack.js");
  const { emptyResume } = await import("../src/lib/storage.js");
  const resume = emptyResume();
  resume.basics = { name: "Siva R", headline: "Engineer", email: "s@x.com", phone: "+1 555",
    location: "Austin, TX", links: [{ label: "GitHub", url: "https://github.com/s" }] };
  resume.skills = [{ id: "1", group: "Languages", items: "SQL, Python" }];
  const answers = [
    { id: "a", label: "Sponsorship?", value: "Yes, will require H-1B" },
    { id: "b", label: "Notice period", value: "" },
  ];
  const pack = buildApplicationPack(resume, answers);
  assert.ok(pack.includes("Siva R"));
  assert.ok(pack.includes("GitHub: https://github.com/s"));
  assert.ok(pack.includes("Sponsorship? Yes, will require H-1B"));
  assert.ok(!pack.includes("Notice period"), "empty answers stay out of the pack");
  assert.ok(pack.includes("Languages: SQL, Python"));
});

test("state normalization seeds default answers", () => {
  const s = normalizeState({ resume: {}, applications: [] });
  assert.ok(s.answers.length >= 5);
  assert.ok(s.answers.some((a) => a.id === "sponsorship"));
});

test("applyParsed maps AI output into ResumeData, keeps template, drops empties", async () => {
  const { applyParsed } = await import("../src/lib/importer.js");
  const { emptyResume } = await import("../src/lib/storage.js");
  const current = emptyResume();
  current.template = "mono";
  const out = applyParsed(current, {
    basics: { name: "Siva R", email: "s@x.com", links: [{ label: "", url: "https://github.com/s" }, { url: "" }] },
    experience: [{ company: "Acme", role: "SDE", bullets: ["Did X", "  ", ""] }],
    skills: [{ group: "Langs", items: "SQL" }, { group: "Empty", items: "  " }],
  });
  assert.equal(out.template, "mono");
  assert.equal(out.basics.name, "Siva R");
  assert.equal(out.basics.links.length, 1);
  assert.equal(out.basics.links[0]!.label, "Link");
  assert.equal(out.experience[0]!.bullets.length, 1);
  assert.equal(out.skills.length, 1);
  assert.ok(out.experience[0]!.id, "entries get ids");
});

test("live ranking: excludes ghosts, honors country and sponsorship, ranks by fit", async () => {
  const { rankFeed, profileFromResume } = await import("../src/lib/fit.js");
  const NOW2 = new Date("2026-08-26T00:00:00Z");
  const mk = (over: Record<string, unknown>) => ({
    key: "k", company: "Acme", title: "Software Engineer", location: "Bengaluru, India",
    country: "in", url: "u", source: "greenhouse",
    publishedAt: "2026-08-24T00:00:00Z", firstSeenAt: "2026-08-24T00:00:00Z",
    ghost: { score: 10, band: "low", reasons: [] }, sponsorship: "unknown", hasSalaryInfo: false,
    ...over,
  }) as never;
  const jobs = [
    mk({ key: "ghost", ghost: { score: 60, band: "high", reasons: [] } }),
    mk({ key: "nosponsor", sponsorship: "no" }),
    mk({ key: "usa", country: "us", location: "Austin, TX" }),
    mk({ key: "good", title: "Senior Backend Engineer", location: "Bengaluru, India" }),
  ];
  const profile = {
    skills: ["backend"], countries: ["in"], locations: ["bengaluru"],
    seniorityTarget: "senior", needsSponsorship: true,
  };
  const out = rankFeed(jobs, profile, 30, NOW2);
  const keys = out.map((m) => m.job.key);
  assert.ok(!keys.includes("ghost"), "ghosts are excluded, never ranked down");
  assert.ok(!keys.includes("nosponsor"), "won't-sponsor filtered when sponsorship is needed");
  assert.ok(!keys.includes("usa"), "other countries filtered out");
  assert.equal(keys[0], "good");
  assert.ok(out[0]!.reasons.some((r) => r.includes("backend")));
  assert.ok(out[0]!.reasons.some((r) => r.includes("Seniority level matches")));

  // Resume prefill pulls skills and location out of the resume the user already wrote.
  const fromResume = profileFromResume({
    skills: [{ items: "TypeScript, SQL" }, { items: "React" }],
    basics: { location: "Bengaluru, IN" },
  });
  assert.deepEqual(fromResume.skills, ["typescript", "sql", "react"]);
  assert.ok(fromResume.locations.includes("bengaluru"));
});

test("ranking caps how many roles one employer can occupy", async () => {
  const { rankFeed } = await import("../src/lib/fit.js");
  const NOW2 = new Date("2026-08-26T00:00:00Z");
  const mk = (key: string, company: string) => ({
    key, company, title: "Backend Engineer", location: "Bengaluru, India", country: "in",
    url: "u" + key, source: "greenhouse",
    publishedAt: "2026-08-25T00:00:00Z", firstSeenAt: "2026-08-25T00:00:00Z",
    ghost: { score: 5, band: "low", reasons: [] }, sponsorship: "unknown", hasSalaryInfo: false,
  }) as never;
  // One giant board plus smaller ones - the giant must not take every slot.
  const jobs = [
    ...Array.from({ length: 20 }, (_, i) => mk(`bosch${i}`, "Bosch")),
    mk("db1", "Databricks"), mk("db2", "Databricks"),
    mk("phonepe", "PhonePe"), mk("cred", "CRED"),
  ];
  const out = rankFeed(jobs, {
    skills: ["backend"], countries: ["in"], locations: [], seniorityTarget: null, needsSponsorship: false,
  }, 10, NOW2);
  assert.equal(out.filter((m) => m.job.company === "Bosch").length, 3, "at most 3 from one employer");
  const companies = new Set(out.map((m) => m.job.company));
  assert.ok(companies.has("PhonePe") && companies.has("CRED"), "smaller employers still reach the list");
});

test("irrelevant roles are excluded, not merely outranked", async () => {
  const { rankFeed } = await import("../src/lib/fit.js");
  const NOW2 = new Date("2026-08-26T00:00:00Z");
  const mk = (key: string, title: string, location: string, tags: string[]) => ({
    key, company: key, title, location, country: "us", url: "u" + key, source: "greenhouse",
    publishedAt: "2026-08-25T00:00:00Z", firstSeenAt: "2026-08-25T00:00:00Z",
    ghost: { score: 5, band: "low", reasons: [] }, sponsorship: "unknown",
    hasSalaryInfo: true, tags,
  }) as never;
  // The sales role wins on seniority + location + freshness + salary alone;
  // only a relevance requirement keeps it out of an engineer's list.
  const jobs = [
    mk("sales", "Senior Account Executive", "Chicago, IL", ["sales"]),
    mk("eng", "Senior Software Engineer", "Seattle, WA", ["python", "aws", "postgres"]),
  ];
  const profile = {
    skills: ["python", "aws", "sql"], countries: ["us"], locations: ["chicago"],
    seniorityTarget: "senior", needsSponsorship: false,
  };
  const out = rankFeed(jobs, profile, 10, NOW2);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.job.key, "eng", "the relevant role is the only one that survives");
});

test("sponsorship facts rank US roles for someone who needs sponsorship", async () => {
  const { rankFeed } = await import("../src/lib/fit.js");
  const NOW2 = new Date("2026-08-27T00:00:00Z");
  const mk = (key: string, sponsor: unknown) => ({
    key, company: key, title: "Backend Engineer", location: "Austin, TX", country: "us",
    url: "u" + key, source: "greenhouse",
    publishedAt: "2026-08-26T00:00:00Z", firstSeenAt: "2026-08-26T00:00:00Z",
    ghost: { score: 5, band: "low", reasons: [] }, sponsorship: "unknown",
    hasSalaryInfo: false, tags: ["backend"], sponsor,
  }) as never;
  const jobs = [
    mk("nofiling", null),
    mk("sponsor", { approvals: 394, denials: 1, fy: 2023, name: "NVIDIA CORPORATION" }),
  ];
  const profile = {
    skills: ["backend"], countries: ["us"], locations: [],
    seniorityTarget: null, needsSponsorship: true,
  };
  const out = rankFeed(jobs, profile, 10, NOW2);
  assert.equal(out[0]!.job.key, "sponsor", "a proven sponsor outranks an employer with no filings");
  assert.ok(out[0]!.reasons.some((r) => r.includes("394") && r.includes("FY2023")));
  // Never hidden: absence of filings is evidence, not proof.
  assert.equal(out.length, 2);
  assert.ok(out[1]!.reasons.some((r) => r.includes("No H-1B filings")));

  // Someone not needing sponsorship is unaffected by filing history.
  const neutral = rankFeed(jobs, { ...profile, needsSponsorship: false }, 10, NOW2);
  assert.ok(!neutral.some((m) => m.reasons.some((r) => r.includes("H-1B"))));
});

test("sponsorsOnly filter keeps only employers with federal filings", async () => {
  const { applyFilters, defaultFilters } = await import("../src/jobs/feed.js");
  const mk = (key: string, sponsor: unknown) => ({
    key, company: key, title: "Engineer", location: "Austin, TX", country: "us",
    url: "u", source: "greenhouse", publishedAt: null, firstSeenAt: "2026-08-26T00:00:00Z",
    ghost: { score: 5, band: "low", reasons: [] }, sponsorship: "unknown",
    hasSalaryInfo: false, sponsor,
  }) as never;
  const jobs = [mk("a", null), mk("b", { approvals: 12, denials: 0, fy: 2023, name: "B INC" })];
  const out = applyFilters(jobs, { ...defaultFilters(), sponsorsOnly: true });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.key, "b");
});

const SIVA = {
  basics: { location: "Open to relocation · India · UAE · Singapore" },
  summary: "Founder building lodging software for independent hotels.",
  experience: [
    {
      company: "Lodginos",
      role: "Founder",
      bullets: [
        "Building a property management system for independent hotels.",
        "Front office, housekeeping and night audit workflows in one product.",
      ],
    },
    { company: "Infosys", role: "Systems Engineer", bullets: ["Java and SQL on client platforms."] },
  ],
  projects: [{ name: "arivo", bullets: ["Guest experience and booking engine for small resorts."] }],
  skills: [{ items: "TypeScript, React, Postgres, Supabase" }],
};

test("profileFromResume keeps the tools listed under Skills", async () => {
  const { profileFromResume } = await import("../src/lib/fit.js");
  const p = profileFromResume(SIVA);
  for (const tool of ["typescript", "react", "postgres", "supabase"]) {
    assert.ok(p.skills.includes(tool), `missing ${tool}`);
  }
});

test("profileFromResume adds the domain the experience demonstrates", async () => {
  // The bug this covers: the Skills line said React and Postgres, so the
  // profile described a generic web developer and the whole hospitality
  // vertical ranked as irrelevant to someone who has only ever built for it.
  const { profileFromResume } = await import("../src/lib/fit.js");
  const p = profileFromResume(SIVA);
  assert.ok(p.skills.includes("hospitality"), `got: ${p.skills.join(", ")}`);
  assert.ok(p.skills.includes("property-management"), `got: ${p.skills.join(", ")}`);
});

test("profileFromResume does not invent domains the resume never mentions", async () => {
  const { profileFromResume } = await import("../src/lib/fit.js");
  const p = profileFromResume({
    basics: { location: "Berlin" },
    summary: "Backend engineer.",
    experience: [{ company: "Acme", role: "Engineer", bullets: ["Go services on Kubernetes."] }],
    projects: [],
    skills: [{ items: "Go, Kubernetes" }],
  });
  for (const t of ["hospitality", "travel", "healthcare", "restaurant"]) {
    assert.ok(!p.skills.includes(t), `${t} should not be present, got: ${p.skills.join(", ")}`);
  }
});

test("profileFromResume works when experience and projects are absent", async () => {
  const { profileFromResume } = await import("../src/lib/fit.js");
  const p = profileFromResume({ basics: { location: "Delhi" }, skills: [{ items: "Python" }] });
  assert.ok(p.skills.includes("python"));
});

test("app domain tags exist as canonical tags in the pipeline dictionary", async () => {
  // Profile tags and posting tags must come from one vocabulary. If the
  // pipeline renames a family and the app does not, ranking silently stops
  // matching that domain for everyone who has it.
  const { readFileSync } = await import("node:fs");
  const dict = readFileSync(new URL("../../jobradar/src/skills.ts", import.meta.url), "utf8");
  const { profileFromResume } = await import("../src/lib/fit.js");
  const domains = profileFromResume(SIVA).skills.filter((s) => s.includes("-") || [
    "hospitality", "travel", "restaurant", "healthcare",
  ].includes(s));
  assert.ok(domains.length > 0, "expected at least one domain tag to check");
  for (const tag of domains) {
    const key = tag.includes("-") ? `"${tag}"` : `${tag}:`;
    assert.ok(dict.includes(key), `pipeline dictionary has no canonical tag ${tag}`);
  }
});
