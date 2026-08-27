import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildSponsorPageFromFeed } from "../src/sponsorpage.js";

const out = () => join(mkdtempSync(join(tmpdir(), "sp-")), "sponsors.html");

const job = (company: string, country: string | null, sponsor: object | null) =>
  ({ company, country, sponsor }) as never;

test("aggregates one row per employer and counts US jobs separately", () => {
  const path = out();
  const n = buildSponsorPageFromFeed({
    generatedAt: "2026-08-27T00:00:00.000Z",
    jobs: [
      job("Stripe", "us", { approvals: 64, denials: 4, fy: 2023, name: "STRIPE INC" }),
      job("Stripe", "us", { approvals: 64, denials: 4, fy: 2023, name: "STRIPE INC" }),
      job("Stripe", "in", { approvals: 64, denials: 4, fy: 2023, name: "STRIPE INC" }),
    ],
  }, { federalRecords: 122857, ingestedAt: "2026-08-26T00:00:00.000Z" }, path);

  assert.equal(n, 1);
  const html = readFileSync(path, "utf8");
  assert.match(html, /Stripe/);
  assert.match(html, /122,857/);
  // three postings at the employer, two of them in the US
  assert.match(html, /<td class="n">3<\/td>\s*<td class="n">2<\/td>/);
});

test("employers with no federal filings never reach the index", () => {
  const path = out();
  const n = buildSponsorPageFromFeed({
    generatedAt: "2026-08-27T00:00:00.000Z",
    jobs: [
      job("Unknown Co", "us", null),
      job("Zero Co", "us", { approvals: 0, denials: 3, fy: 2023, name: "ZERO CO" }),
    ],
  }, null, path);
  assert.equal(n, 0);
  assert.doesNotMatch(readFileSync(path, "utf8"), /Zero Co|Unknown Co/);
});

test("sorts by approvals, breaking ties on US openings", () => {
  const path = out();
  buildSponsorPageFromFeed({
    generatedAt: "2026-08-27T00:00:00.000Z",
    jobs: [
      job("Small", "us", { approvals: 5, denials: 0, fy: 2023, name: "SMALL INC" }),
      job("TieA", "us", { approvals: 50, denials: 0, fy: 2023, name: "TIEA INC" }),
      job("TieB", "us", { approvals: 50, denials: 0, fy: 2023, name: "TIEB INC" }),
      job("TieB", "us", { approvals: 50, denials: 0, fy: 2023, name: "TIEB INC" }),
      job("Big", "us", { approvals: 998, denials: 17, fy: 2023, name: "BIG LLP" }),
    ],
  }, null, path);
  const html = readFileSync(path, "utf8");
  const order = ["Big", "TieB", "TieA", "Small"].map((c) => html.indexOf(`>${c}<`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "rows are out of order");
});

test("builds with no meta file rather than refusing to render", () => {
  // The record count lives in a file the monthly ingest writes. A fresh clone
  // that has not run it must still get a page, not a crash.
  const path = out();
  const n = buildSponsorPageFromFeed({
    generatedAt: "2026-08-27T00:00:00.000Z",
    jobs: [job("Figma", "us", { approvals: 10, denials: 0, fy: 2023, name: "FIGMA INC" })],
  }, null, path);
  assert.equal(n, 1);
  assert.match(readFileSync(path, "utf8"), /Figma/);
});

test("escapes employer names instead of injecting them as markup", () => {
  const path = out();
  buildSponsorPageFromFeed({
    generatedAt: "2026-08-27T00:00:00.000Z",
    jobs: [job('<script>x</script> & Co', "us",
      { approvals: 1, denials: 0, fy: 2023, name: '"Q" <b>' })],
  }, null, path);
  const html = readFileSync(path, "utf8");
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt; &amp; Co/);
});
