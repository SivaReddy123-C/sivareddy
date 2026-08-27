import assert from "node:assert/strict";
import { test } from "node:test";
import { capPerCompany } from "../src/rank.js";

const job = (company_id: string | undefined, id: string) => ({ post: { company_id, id } });

test("caps each employer at three and keeps filling from the rest", () => {
  const scored = [
    ...Array.from({ length: 10 }, (_, i) => job("big", `big${i}`)),
    ...Array.from({ length: 10 }, (_, i) => job("other", `other${i}`)),
  ];
  const out = capPerCompany(scored, 30);
  assert.equal(out.filter((s) => s.post.company_id === "big").length, 3);
  assert.equal(out.filter((s) => s.post.company_id === "other").length, 3);
  assert.equal(out.length, 6);
});

test("a missing employer id must not collapse the whole list", () => {
  // The bug: the query feeding this never selected company_id, so every
  // posting keyed on undefined, collided in one bucket, and a cap meant to
  // allow three per company allowed three in total. The daily list was three
  // jobs drawn from more than a thousand eligible ones.
  const scored = Array.from({ length: 40 }, (_, i) => job(undefined, `j${i}`));
  const out = capPerCompany(scored, 30);
  assert.equal(out.length, 30, `expected a full list, got ${out.length}`);
});

test("empty-string and null employer ids are treated the same way", () => {
  const scored = [
    ...Array.from({ length: 15 }, (_, i) => job("", `blank${i}`)),
    ...Array.from({ length: 15 }, (_, i) => job(null as unknown as undefined, `null${i}`)),
  ];
  assert.equal(capPerCompany(scored, 30).length, 30);
});

test("never returns more than the requested list size", () => {
  const scored = Array.from({ length: 100 }, (_, i) => job(`co${i}`, `j${i}`));
  assert.equal(capPerCompany(scored, 30).length, 30);
});

test("preserves the order it was given", () => {
  const scored = [job("a", "first"), job("b", "second"), job("a", "third")];
  assert.deepEqual(capPerCompany(scored, 30).map((s) => s.post.id), ["first", "second", "third"]);
});

test("one dominant employer cannot fill a list on its own", () => {
  const scored = [
    ...Array.from({ length: 50 }, (_, i) => job("giant", `g${i}`)),
    ...Array.from({ length: 50 }, (_, i) => job(`small${i}`, `s${i}`)),
  ];
  const out = capPerCompany(scored, 30);
  assert.equal(out.filter((s) => s.post.company_id === "giant").length, 3);
  assert.equal(out.length, 30);
});
