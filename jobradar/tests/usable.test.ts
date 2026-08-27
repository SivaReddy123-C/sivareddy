import assert from "node:assert/strict";
import { test } from "node:test";
import { isUsable } from "../src/types.js";

const job = (over: Partial<Record<string, unknown>> = {}) => ({
  key: "workday:nvidia:/job/123",
  source: "workday",
  company: "NVIDIA",
  companyToken: "nvidia",
  sourceJobId: "/job/123",
  title: "Senior Software Engineer",
  location: "Santa Clara, CA",
  remote: null,
  url: "https://nvidia.wd5.myworkdayjobs.com/job/123",
  applyUrl: null,
  department: null,
  employmentType: null,
  description: null,
  hasSalaryInfo: false,
  publishedAt: null,
  updatedAt: null,
  ...over,
}) as never;

test("a complete posting passes", () => {
  assert.equal(isUsable(job()), true);
});

test("the record that broke the sync is rejected", () => {
  // NVIDIA's Workday tenant returned a posting with no title. It reached the
  // database and violated the NOT NULL constraint on jr_job_postings.title,
  // failing a run in which all 302 boards had already been fetched.
  assert.equal(isUsable(job({ title: null })), false);
});

test("rejects a title that is only whitespace", () => {
  assert.equal(isUsable(job({ title: "   " })), false);
  assert.equal(isUsable(job({ title: "" })), false);
});

test("rejects a posting with no id to deduplicate on", () => {
  for (const bad of [null, undefined, "", "  "]) {
    assert.equal(isUsable(job({ sourceJobId: bad })), false, `id ${JSON.stringify(bad)}`);
  }
});

test("rejects a posting with no link to apply through", () => {
  // A row the user cannot click is worse than no row: it costs them a read.
  assert.equal(isUsable(job({ url: "" })), false);
  assert.equal(isUsable(job({ url: null })), false);
});

test("does not reject postings merely missing optional fields", () => {
  // Workday never sends a description, and half our sources omit location.
  assert.equal(isUsable(job({ description: null, location: "", publishedAt: null })), true);
});
