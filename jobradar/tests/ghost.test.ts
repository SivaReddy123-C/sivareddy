import assert from "node:assert/strict";
import { test } from "node:test";
import { assessGhost } from "../src/ghost.js";
import type { Job, JobHistory } from "../src/types.js";

const NOW = new Date("2026-08-25T00:00:00Z");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    key: "greenhouse:acme:1",
    source: "greenhouse",
    company: "Acme",
    companyToken: "acme",
    sourceJobId: "1",
    title: "Backend Engineer",
    location: "Bengaluru, India",
    remote: false,
    url: "https://example.com/1",
    applyUrl: "https://example.com/1/apply",
    department: "Engineering",
    employmentType: "Full-time",
    description: "x".repeat(1200),
    hasSalaryInfo: true,
    publishedAt: "2026-08-20T00:00:00Z",
    updatedAt: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

test("fresh, complete posting scores low", () => {
  const a = assessGhost(makeJob(), null, NOW);
  assert.equal(a.band, "low");
  assert.ok(a.score < 25, `expected <25, got ${a.score}`);
});

test("evergreen talent-pool posting is flagged hard", () => {
  const a = assessGhost(makeJob({ title: "Join our Talent Community" }), null, NOW);
  assert.ok(a.signals.some((s) => s.id === "evergreen_title"));
  assert.ok(a.score >= 40);
});

test("90+ day old posting gains stale signal", () => {
  const a = assessGhost(makeJob({ publishedAt: "2026-04-01T00:00:00Z" }), null, NOW);
  assert.ok(a.signals.some((s) => s.id === "stale_90d"));
});

test("falls back to firstSeenAt when source has no publish date", () => {
  const history: JobHistory = {
    firstSeenAt: "2026-05-01T00:00:00Z",
    lastSeenAt: "2026-08-24T00:00:00Z",
    seenIds: ["1"],
  };
  const a = assessGhost(makeJob({ publishedAt: null }), history, NOW);
  assert.ok(a.signals.some((s) => s.id === "stale_90d"));
});

test("repost churn across ids is flagged", () => {
  const history: JobHistory = {
    firstSeenAt: "2026-07-01T00:00:00Z",
    lastSeenAt: "2026-08-24T00:00:00Z",
    seenIds: ["1", "2", "3"],
  };
  const a = assessGhost(makeJob(), history, NOW, 1);
  assert.ok(a.signals.some((s) => s.id === "reposted"));
});

test("concurrent identical openings are headcount, not reposts", () => {
  const history: JobHistory = {
    firstSeenAt: "2026-07-01T00:00:00Z",
    lastSeenAt: "2026-08-24T00:00:00Z",
    seenIds: ["1", "2"],
  };
  const a = assessGhost(makeJob(), history, NOW, 2);
  assert.ok(!a.signals.some((s) => s.id === "reposted"));
});

test("engineering 'Pipelines' titles are not evergreen-flagged", () => {
  for (const title of ["Sr. Engineering Manager - Pipelines Engine", "Staff Engineer, Data Pipelines"]) {
    const a = assessGhost(makeJob({ title }), null, NOW);
    assert.ok(!a.signals.some((s) => s.id === "evergreen_title"), title);
  }
  const a = assessGhost(makeJob({ title: "Engineering Talent Pipeline" }), null, NOW);
  assert.ok(a.signals.some((s) => s.id === "evergreen_title"));
});

test("missing everything stacks toward critical", () => {
  const a = assessGhost(
    makeJob({
      title: "General Application - Future Opportunities",
      publishedAt: "2026-01-01T00:00:00Z",
      description: "Apply here.",
      hasSalaryInfo: false,
      location: "",
    }),
    null,
    NOW,
  );
  assert.equal(a.band, "critical");
});

test("null description (source did not provide one) is not penalized", () => {
  const a = assessGhost(makeJob({ description: null }), null, NOW);
  assert.ok(!a.signals.some((s) => s.id === "thin_description"));
});
