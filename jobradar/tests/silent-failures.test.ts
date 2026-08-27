import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOTS = ["jobradar/src", "app/src"];
const REPO = join(import.meta.dirname, "..", "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const allSources = ROOTS.flatMap((r) => sources(join(REPO, r)));

test("there is source to scan", () => {
  assert.ok(allSources.length > 20, `only found ${allSources.length} source files`);
});

/**
 * Every failure this codebase shipped tonight was silent.
 *
 * A counter that never incremented, a column never selected, a cache write
 * that threw into an empty catch, a feed error discarded by `.catch(() =>
 * null)`. All four typechecked, ran green, and reported success while doing
 * nothing. Tests cannot catch a bug nobody knew to write a test for - but they
 * can refuse the shape that hides it.
 *
 * A catch that swallows must say so with `// silent-ok: <reason>`, which makes
 * the decision visible in review instead of invisible in production.
 */
test("no catch block discards an error without saying why", () => {
  const offenders: string[] = [];
  for (const file of allSources) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!/\bcatch\s*(\([^)]*\))?\s*\{/.test(line)) continue;
      // Collect the block body up to its closing brace (these are all short).
      let depth = 0, body = "", j = i;
      for (; j < lines.length && j < i + 40; j++) {
        for (const ch of lines[j]!) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
        if (j > i) body += `${lines[j]}\n`;
        if (depth === 0 && j > i) break;
      }
      const code = body
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/[}\s]/g, "");
      const declared = /silent-ok:/.test(body) || /silent-ok:/.test(line);
      if (code.length === 0 && !declared) {
        offenders.push(`${file.replace(REPO, "").replace(/^\//, "")}:${i + 1}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `catch blocks that swallow an error must carry "// silent-ok: <reason>":\n  ${offenders.join("\n  ")}`);
});

/**
 * A row interface is a promise about what the query returned. Supabase results
 * are cast, not checked, so a column left out of the select is undefined at
 * runtime while TypeScript still believes the interface.
 *
 * That is exactly how the daily list collapsed to three jobs: company_id was
 * declared on PostingRow, never selected, and every posting keyed on undefined
 * in the per-employer cap.
 */
test("every column a row interface declares is actually selected", () => {
  const failures: string[] = [];
  for (const file of allSources) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/interface\s+(\w*Row)\s*\{([^}]*)\}/g)) {
      const [, name, body] = m;
      const keys = [...body!.matchAll(/^\s*(\w+)\s*[?]?\s*:/gm)].map((k) => k[1]!);
      if (keys.length === 0) continue;
      // Find a select() whose column list overlaps this interface at all.
      for (const sel of src.matchAll(/\.select\(\s*"([^"]+)"/g)) {
        const cols = sel[1]!.split(",").map((c) => c.trim().split(/[\s(]/)[0]);
        if (cols.length < 3) continue;
        const overlap = keys.filter((k) => cols.includes(k)).length;
        if (overlap < Math.max(3, keys.length / 2)) continue; // not this interface
        const missing = keys.filter((k) => !cols.includes(k));
        if (missing.length > 0) {
          failures.push(`${file.replace(REPO, "").replace(/^\//, "")}: ${name} declares `
            + `${missing.join(", ")} but the select does not fetch them`);
        }
      }
    }
  }
  assert.deepEqual(failures, [], `\n  ${failures.join("\n  ")}`);
});
