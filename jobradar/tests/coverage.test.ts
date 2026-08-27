import assert from "node:assert/strict";
import { test } from "node:test";
import { assess, THIN } from "../src/coverage.js";

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
