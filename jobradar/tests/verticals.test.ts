import assert from "node:assert/strict";
import { test } from "node:test";
import { industryOf, industryFrom } from "../src/verticals.js";
import { extractTags } from "../src/skills.js";

test("a company that IS the vertical is labelled", () => {
  assert.equal(industryOf("Cloudbeds"), "hospitality");
  assert.equal(industryOf("Lighthouse"), "hospitality");
  assert.equal(industryOf("Marriott"), "hospitality");
  assert.equal(industryOf("Agoda"), "travel");
  assert.equal(industryOf("Toast"), "restaurant");
});

test("a company that merely sells into a vertical is not labelled", () => {
  // Decagon had fifteen postings tagged hospitality - payroll manager, office
  // manager, compensation lead - because every posting lists the industries it
  // serves. Selling to hotels is not being a hotel company.
  assert.equal(industryOf("Decagon"), null);
  assert.equal(industryOf("Databricks"), null);
  assert.equal(industryOf("Suno"), null);
});

test("matching ignores punctuation and case in the employer name", () => {
  assert.equal(industryOf("booking.com"), "travel");
  assert.equal(industryOf("BOOKING.COM"), "travel");
  assert.equal(industryOf("Owner.com"), "restaurant");
});

test("industryFrom works from an explicit map, for callers that supply one", () => {
  const map = { hospitality: ["Acme Hotels"] };
  assert.equal(industryFrom(map, "acme hotels"), "hospitality");
  assert.equal(industryFrom(map, "Acme Software"), null);
});

test("a market named in an about-us blurb no longer tags the posting", () => {
  // However many times it is repeated: a company selling to six industries
  // names all six in every posting. Only the title says what this job is.
  const blurb = "We serve hospitality, retail and healthcare. Our hospitality "
    + "customers include major hotel brands, and hospitality is a core market.";
  const tags = extractTags("Payroll Manager", `${blurb} You will run payroll.`);
  assert.ok(!tags.includes("hospitality"), `got: ${tags.join(", ")}`);
});

test("a posting whose title states the domain is still tagged", () => {
  assert.ok(extractTags("Sr. Solutions Architect - Retail, Travel & Hospitality", "").includes("hospitality"));
  assert.ok(extractTags("Hotel Operations Manager", "").includes("hospitality"));
});

test("specific domain terms still stand on their own without the title", () => {
  assert.ok(extractTags("Engineer", "Build our channel manager and booking engine.")
    .includes("property-management"));
  assert.ok(extractTags("Analyst", "Own RevPAR and rate parity.").includes("revenue-management"));
});
