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

test("acronyms that collide with tech vocabulary do not tag a domain", () => {
  // Every one of these appeared in the feed after the first pass. OTA is
  // over-the-air at a chip company, RMS is root mean square, ADR is an
  // architecture decision record, PMS is often project management.
  const cases: [string, string][] = [
    ["OTA/Cloud Validation Engineer", "Over-the-air update validation for embedded devices."],
    ["Signal Processing Engineer", "Compute RMS noise across the wafer."],
    ["Staff Engineer", "Write an ADR for each significant decision."],
    ["Program Manager", "Own the PMS rollout for the engineering org."],
  ];
  for (const [title, desc] of cases) {
    const tags = extractTags(title, desc);
    for (const d of ["travel", "revenue-management", "property-management", "hospitality"]) {
      assert.ok(!tags.includes(d), `"${title}" wrongly tagged ${d}: ${tags.join(", ")}`);
    }
  }
});

test("one mention of a market in an about-us blurb does not tag the job", () => {
  // A warehouse job at a pizza-ordering company was reading as a restaurant
  // job, because the company describes itself as serving restaurants.
  const boilerplate = "About us: we build software for restaurants across the country.";
  const tags = extractTags("Delivery & Warehouse Associate", `${boilerplate} You will load vans and manage inventory.`);
  assert.ok(!tags.includes("restaurant"), `got: ${tags.join(", ")}`);
});

test("a job genuinely about the domain is still tagged", () => {
  // Title match alone is enough.
  assert.ok(extractTags("Restaurant Onboarding Manager", "Help merchants go live.").includes("restaurant"));
  // So is a body that keeps returning to it.
  const real = extractTags("Implementation Manager",
    "Onboard restaurant groups. You will configure each restaurant's menu and train restaurant staff.");
  assert.ok(real.includes("restaurant"), `got: ${real.join(", ")}`);
});
