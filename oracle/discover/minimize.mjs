// Step 4: reduce each category-A1 input (valid for Babel and oxc, not clean for tree-sitter) to a short reproducer.
//   node minimize.mjs [--mode accept|reject] [--tsparse BIN] [--data DIR] [--defects FILE] [--out FILE] [--shard i/n] [--budget-s 60]
// accept (default; defects.jsonl -> min.jsonl): the predicate keeps all three of: the tree is still not clean, Babel still
// accepts and oxc still accepts (same source type, semantic errors counted), so a reproducer is always valid JavaScript.
// reject (rejects.jsonl -> min-reject.jsonl, the B1 inputs): the tree has no ERROR/MISSING while Babel and oxc both still
// report a syntax error, so a reproducer is always a grammar error that this grammar misses. The predicates are in
// predicate.mjs, the reduction in reduce.mjs (a window around the first error for big files, then ddmin over lines, then
// over tokens, then a simplification pass). One `tsparse -serve` child per run.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { babel, oxc } from "./tools.mjs";
import { makePredicate } from "./predicate.mjs";
import { reduce } from "./reduce.mjs";
import { startTs } from "./tsserve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const bin = resolve(flag("--tsparse", join(here, "../../build/discovery/tsparse.exe")));
const data = resolve(flag("--data", join(here, "../../build/discovery/data")));
const mode = flag("--mode", "accept");
const defectsPath = resolve(flag("--defects", join(here, `../../build/discovery/${mode === "accept" ? "defects" : "rejects"}.jsonl`)));
const outPath = resolve(flag("--out", join(here, `../../build/discovery/${mode === "accept" ? "min" : "min-reject"}.jsonl`)));
const [shard, shards] = flag("--shard", "0/1").split("/").map(Number);
const budgetMs = Number(flag("--budget-s", "60")) * 1000;

const ts = startTs(bin);
const tsAsk = (s) => ts.ask({ s });
const pred = makePredicate(mode, { ts: tsAsk, babel, oxc });
let calls = 0;

async function minimize(src, type, errRow) {
  const cause = pred.cause(src, type);
  const test = (s) => (calls++, pred.test(s, type, cause));
  if (!(await test(src))) return { src, ok: false, why: "the input is not a reproducer for this predicate" };
  const cur = await reduce(src, test, { budgetMs, errRow });
  if (!(await test(cur))) return { src: cur, ok: false, why: "internal: final text lost the property" };
  return { src: cur, ok: true };
}

// ---- main ----------------------------------------------------------------------------------------------------------
const defects = readFileSync(defectsPath, "utf8").split("\n").filter(Boolean).map(JSON.parse).filter((_, i) => i % shards === shard);
const resultsById = new Map(readFileSync(join(dirname(defectsPath), "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
writeFileSync(outPath, "");
const t0 = Date.now();
let done = 0;
for (const d of defects) {
  const res = resultsById.get(d.id);
  const text = d.prefix + readFileSync(join(data, d.id), "utf8");
  const t1 = Date.now();
  const c0 = calls;
  const r = await minimize(text, d.type, res.ts.row + (d.prefix ? 1 : 0));
  const t = await tsAsk(r.src);
  appendFileSync(outPath, JSON.stringify({ id: d.id, set: d.set, type: d.type, from: text.length, ok: r.ok, why: r.why, min: r.src, calls: calls - c0, ms: Date.now() - t1, kind: t.k, at: t.at, group: res.group }) + "\n");
  if (++done % 20 === 0) console.error(`shard ${shard}: ${done}/${defects.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
ts.close();
console.log(`minimize shard ${shard}/${shards}: ${done} inputs, ${calls} predicate calls, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
