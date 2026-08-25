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
  assert.ok(weak.some((h) => h.includes("No number")));
  assert.deepEqual(checkBullet("Reduced build time 40% by caching dependencies"), []);
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
