import assert from "node:assert/strict";
import { test } from "node:test";
import { computeStats, isLikelyGhosted } from "../src/lib/stats.js";
import { emptyState, exportJson, importJson, normalizeState } from "../src/lib/storage.js";
import type { Application } from "../src/lib/types.js";

const NOW = new Date("2026-08-25T00:00:00Z");

function app(overrides: Partial<Application>): Application {
  return {
    id: "x", company: "Acme", title: "SWE", url: "", location: "", source: "",
    appliedAt: "2026-08-20T00:00:00Z", status: "applied",
    statusChangedAt: "2026-08-20T00:00:00Z", notes: "",
    ...overrides,
  };
}

test("ghosted only after threshold and only while still 'applied'", () => {
  assert.ok(!isLikelyGhosted(app({ appliedAt: "2026-08-10T00:00:00Z" }), NOW));
  assert.ok(isLikelyGhosted(app({ appliedAt: "2026-08-01T00:00:00Z" }), NOW));
  assert.ok(!isLikelyGhosted(app({ appliedAt: "2026-08-01T00:00:00Z", status: "rejected" }), NOW));
});

test("stats: rejections count as replies (honest reply rate), null rate when empty", () => {
  const s = computeStats(
    [app({ status: "rejected" }), app({ status: "interview" }), app({}), app({})],
    NOW,
  );
  assert.equal(s.total, 4);
  assert.equal(s.replied, 2);
  assert.equal(s.replyRate, 50);
  assert.equal(s.interviews, 1);
  assert.equal(computeStats([], NOW).replyRate, null);
});

test("export/import round-trips and survives junk", () => {
  const state = emptyState();
  state.applications.push(app({}));
  const back = importJson(exportJson(state));
  assert.equal(back.applications.length, 1);
  assert.equal(back.applications[0]!.company, "Acme");
  const junk = normalizeState({ resume: { basics: { name: "S" } }, applications: "nope" });
  assert.equal(junk.resume.basics.name, "S");
  assert.deepEqual(junk.applications, []);
  assert.equal(junk.resume.template, "classic");
});
