import assert from "node:assert/strict";
import { test } from "node:test";
import { assess, countriesFor, format, THIN } from "../src/coverage.js";

const posting = (tags: string[], title: string, country: string | null) => ({ tags, title, country });

test("a skill our inventory barely carries is reported as thin", () => {
  // The failure this was written for: a hospitality background against a feed
  // of 33,000 tech postings that carried about 25 hospitality roles.
  const postings = [
    ...Array.from({ length: 900 }, () => posting(["react"], "Frontend Engineer", "us")),
    ...Array.from({ length: 25 }, () => posting(["hospitality"], "Revenue Manager", "us")),
  ];
  const { gaps, covered } = assess(["react", "hospitality"], [], postings);
  assert.deepEqual(gaps.map((g) => g.skill), ["hospitality"]);
  assert.deepEqual(covered.map((c) => c.skill), ["react"]);
  assert.equal(gaps[0]!.postings, 25);
});

test("counts only postings in countries the user would actually take", () => {
  // 200 matches is comfortably above the threshold, but if they are all in a
  // country the user cannot work in, their real coverage is zero.
  const postings = Array.from({ length: 200 }, () => posting(["python"], "Engineer", "us"));
  const { gaps } = assess(["python"], ["in", "ae"], postings);
  assert.equal(gaps.length, 1, "should be thin for a user targeting India/UAE");
  assert.equal(gaps[0]!.postings, 200);
  assert.equal(gaps[0]!.inTargetCountries, 0);
});

test("matches on title as well as tag", () => {
  const postings = Array.from({ length: THIN + 1 }, () => posting([], "Kubernetes Platform Engineer", "de"));
  const { covered } = assess(["kubernetes"], [], postings);
  assert.equal(covered.length, 1);
});

test("thin skills are listed scarcest first", () => {
  const postings = [
    ...Array.from({ length: 10 }, () => posting(["rust"], "Rust Engineer", "us")),
    ...Array.from({ length: 2 }, () => posting(["cobol"], "COBOL Developer", "us")),
  ];
  const { gaps } = assess(["rust", "cobol"], [], postings);
  assert.deepEqual(gaps.map((g) => g.skill), ["cobol", "rust"]);
});

test("a skill with no postings at all is a gap, not a crash", () => {
  const { gaps } = assess(["fortran"], [], [posting(["react"], "Engineer", "us")]);
  assert.equal(gaps[0]!.postings, 0);
  assert.equal(gaps[0]!.inTargetCountries, 0);
});

test("blank skills are ignored", () => {
  const { gaps, covered } = assess(["", "   "], [], [posting(["react"], "Engineer", "us")]);
  assert.equal(gaps.length + covered.length, 0);
});

test("says where the work is when the target countries do not hold it", () => {
  // The gap Siva hit: the vertical is well covered, but his four countries
  // hold almost none of it. "Thin" alone does not tell him to look at Thailand.
  const p = (c: string | null) => ({ tags: ["hospitality"], title: "Revenue Manager", country: c });
  const postings = [
    ...Array.from({ length: 494 }, () => p("us")),
    ...Array.from({ length: 199 }, () => p("th")),
    ...Array.from({ length: 50 }, () => p("in")),
  ];
  const where = countriesFor(["hospitality"], ["in", "ae", "sg", "nl"], postings);
  assert.deepEqual(where.slice(0, 3).map((c) => c.country), ["us", "th", "in"]);
  assert.equal(where.find((c) => c.country === "in")?.targeted, true);
  assert.equal(where.find((c) => c.country === "us")?.targeted, false);
});

test("the report names the countries holding the work", () => {
  const p = (c: string) => ({ tags: ["hospitality"], title: "Revenue Manager", country: c });
  const postings = [...Array.from({ length: 400 }, () => p("us")), ...Array.from({ length: 40 }, () => p("in"))];
  const where = countriesFor(["hospitality"], ["in"], postings);
  const text = format(
    { userId: "abcd1234-0000", totalPostings: 440, gaps: [{ skill: "hospitality", postings: 440, inTargetCountries: 40 }], covered: [] },
    where,
  );
  assert.match(text, /reachable in the countries on this profile: 40/);
  assert.match(text, /us 400/);
});

test("postings with no country are ignored rather than counted as a place", () => {
  const where = countriesFor(["python"], ["in"],
    [{ tags: ["python"], title: "Engineer", country: null }]);
  assert.deepEqual(where, []);
});
