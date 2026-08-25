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
