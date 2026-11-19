// Reduce each input of structure.jsonl (a range mismatch between Babel's AST and this grammar's tree) to a short valid reproducer.
//   node structure-min.mjs [--in FILE] [--out FILE] [--data DIR] [--oracle FILE] [--tsparse BIN] [--shard i/n] [--budget-s 20] [--limit N]
// The predicate (predicate.mjs, mode structure) keeps: tree-sitter tree clean, Babel and oxc both accept, and a mismatch with the
// same side, family, kind and parent kind as the input's first mismatch. An input whose sha256 is no longer the recorded one is `ok: false`. Reduction is reduce.mjs, as for the other modes.
// Writes OUT (default build/structure/min-structure.jsonl): id, set, type, min, ok, the mismatches of the reduced text.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { babel, oxc } from "./tools.mjs";
import { makePredicate } from "./predicate.mjs";
import { reduce } from "./reduce.mjs";
import { makeChecker } from "./structure-check.mjs";
import { readPrefixes, readVerified } from "./inputs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const dir = join(here, "../../build/structure");
const inPath = resolve(flag("--in", join(dir, "structure.jsonl")));
const outPath = resolve(flag("--out", join(dir, "min-structure.jsonl")));
const data = resolve(flag("--data", join(here, "../../build/discovery/data")));
const bin = resolve(flag("--tsparse", join(dir, "tsparse.exe")));
const [shard, shards] = flag("--shard", "0/1").split("/").map(Number);
const budgetMs = Number(flag("--budget-s", "20")) * 1000;
const limit = Number(flag("--limit", "0"));

const checker = await makeChecker(bin);
const pred = makePredicate("structure", {
  ts: (s) => checker.ts.ask({ s }),
  babel,
  oxc,
  structure: async (src, type) => (await checker.check(src, type)).diffs ?? [],
});
const prefixes = readPrefixes(resolve(flag("--oracle", join(here, "../../build/discovery/oracle.jsonl"))));

let rows = readFileSync(inPath, "utf8").split("\n").filter(Boolean).map(JSON.parse).filter((r) => r.status === "diff" && r.diffs.length);
rows = rows.filter((_, i) => i % shards === shard);
if (limit) rows.length = Math.min(rows.length, limit);
writeFileSync(outPath, "");
const t0 = Date.now();
let done = 0;
let calls = 0;
let inputErrors = 0;
for (const r of rows) {
  if (r.set === "corpus" || r.set === "files") continue; // corpus/files runs are small: their inputs are already short
  let text;
  try {
    text = (prefixes.get(r.id) ?? "") + readVerified(join(data, r.id), r.sha256);
  } catch (e) {
    appendFileSync(outPath, JSON.stringify({ id: r.id, set: r.set, type: r.type, ok: false, why: `input-error: ${e.message}`, min: "", diffs: [] }) + "\n");
    inputErrors++;
    continue;
  }
  const cause = pred.cause(r.diffs[0]);
  const test = (s) => (calls++, pred.test(s, r.type, cause));
  let min = text;
  let ok = await test(text);
  if (ok) {
    const errRow = Buffer.from(text).subarray(0, r.diffs[0].s).toString().split("\n").length - 1;
    min = await reduce(text, test, { budgetMs, errRow });
    ok = await test(min);
  }
  const diffs = ok ? (await checker.check(min, r.type)).diffs.slice(0, 6) : [];
  appendFileSync(outPath, JSON.stringify({ id: r.id, set: r.set, type: r.type, from: text.length, ok, cause, min, diffs }) + "\n");
  if (++done % 25 === 0) console.error(`shard ${shard}: ${done}/${rows.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
checker.close();
if (inputErrors) { console.error(`structure-min: ${inputErrors} inputs were unreadable or changed since collect`); process.exitCode = 3; }
console.log(`structure-min shard ${shard}/${shards}: ${done} inputs, ${calls} predicate calls, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
