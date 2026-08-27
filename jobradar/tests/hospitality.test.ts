import assert from "node:assert/strict";
import { test } from "node:test";
import { extractTags } from "../src/skills.js";

const has = (title: string, desc: string, tag: string) =>
  extractTags(title, desc).includes(tag);

test("hotel operations roles are tagged hospitality", () => {
  assert.ok(has("Front Office Supervisor", "Lead front desk and concierge team.", "hospitality"));
  assert.ok(has("Housekeeping Manager", "Rooms division.", "hospitality"));
  assert.ok(has("F&B Director", "Banquet and catering operations.", "hospitality"));
});

test("hotel software roles are tagged by what they build", () => {
  assert.ok(has("Engineer", "Build our cloud PMS and channel manager.", "property-management"));
  assert.ok(has("Analyst", "Own RevPAR and ADR strategy; rate parity.", "revenue-management"));
  assert.ok(has("Engineer", "Restaurant point of sale and kitchen display.", "restaurant"));
  assert.ok(has("Manager", "Onboard hotel groups onto our booking engine and CRS.", "property-management"));
});

test("night audit is a hotel shift, not an accounting role", () => {
  // The finance dictionary matched "audit" inside "night audit", which put a
  // front-desk overnight role in the same bucket as a controller.
  const tags = extractTags("Night Auditor", "Overnight front desk and night audit duties.");
  assert.ok(tags.includes("hospitality"), "should be hospitality");
  assert.ok(!tags.includes("finance"), `should not be finance, got: ${tags.join(", ")}`);
});

test("real accounting roles are still tagged finance", () => {
  assert.ok(has("Internal Audit Manager", "Lead the internal audit and controls function.", "finance"));
  assert.ok(has("Staff Accountant", "Month-end close and audit support.", "finance"));
});

test("unrelated engineering roles pick up no hospitality tags", () => {
  const tags = extractTags("Senior Data Engineer", "Build pipelines in Python and SQL.");
  for (const t of ["hospitality", "travel", "property-management", "revenue-management", "restaurant"]) {
    assert.ok(!tags.includes(t), `${t} should not be present, got: ${tags.join(", ")}`);
  }
});

test("travel platforms are tagged travel", () => {
  assert.ok(has("Engineer", "Work on our online travel marketplace and itinerary tools.", "travel"));
  assert.ok(has("Manager", "Partner with airline and cruise suppliers.", "travel"));
});
