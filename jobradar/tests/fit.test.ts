import { strict as assert } from "node:assert";
import { test } from "node:test";
import { passesHardFilters, scoreFit, skillMentioned, type FitPosting, type FitProfile } from "../src/fit.js";

const posting = (over: Partial<FitPosting> = {}): FitPosting => ({
  title: "Backend Engineer",
  location: "Austin, TX",
  country: "us",
  descriptionText: "We build services in Go and Postgres.",
  hasSalary: false,
  postedAt: new Date().toISOString(),
  firstSeenAt: new Date().toISOString(),
  ghostScore: 0,
  sponsorship: "unknown",
  ...over,
});

const profile = (over: Partial<FitProfile> = {}): FitProfile => ({
  skills: [],
  countries: [],
  locations: [],
  seniorityTarget: null,
  needsSponsorship: false,
  ...over,
});

test("skill tokens do not match inside longer words", () => {
  assert.equal(skillMentioned("work at google on categories", "go"), false);
  assert.equal(skillMentioned("javascript everywhere", "java"), false);
  assert.equal(skillMentioned("we write go services", "go"), true);
  assert.equal(skillMentioned("modern c++ codebase", "c++"), true);
  assert.equal(skillMentioned("systems in c and rust", "c"), true);
});

test("skill synonyms match both directions", () => {
  assert.equal(skillMentioned("golang microservices", "go"), true);
  assert.equal(skillMentioned("we use go daily", "golang"), true);
  assert.equal(skillMentioned("node.js backend", "node"), true);
  assert.equal(skillMentioned("typescript strict mode", "ts"), true);
});

test("cannot-sponsor postings are hard-filtered for students who need sponsorship", () => {
  const p = profile({ needsSponsorship: true });
  assert.equal(passesHardFilters(p, posting({ sponsorship: "no" })), false);
  assert.equal(passesHardFilters(p, posting({ sponsorship: "unknown" })), true);
  assert.equal(passesHardFilters(p, posting({ sponsorship: "yes" })), true);
  // Users who do not need sponsorship see everything.
  assert.equal(passesHardFilters(profile(), posting({ sponsorship: "no" })), true);
});

test("explicit sponsorship boosts score only for those who need it", () => {
  const needs = scoreFit(profile({ needsSponsorship: true }), posting({ sponsorship: "yes" }));
  assert.ok(needs.reasons.some((r) => r.includes("sponsorship")));
  const doesnt = scoreFit(profile(), posting({ sponsorship: "yes" }));
  assert.equal(doesnt.reasons.some((r) => r.includes("sponsorship")), false);
});

test("matched skills still score", () => {
  const r = scoreFit(profile({ skills: ["go", "postgres"] }), posting());
  assert.ok(r.score >= 30);
  assert.ok((r.reasons[0] ?? "").includes("go"));
});
