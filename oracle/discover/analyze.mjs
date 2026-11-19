// Step 3: join the oracle verdicts (collect.mjs) with the tree-sitter results (tsparse) and classify every input.
//   node analyze.mjs [--dir build/discovery]
// Reads DIR/oracle.jsonl and DIR/ts.jsonl; writes DIR/results.jsonl (one record per input), DIR/defects.jsonl (A1) and
// DIR/rejects.jsonl (B1), which the minimiser takes, and DIR/summary.json. Categories (see README.md):
//   A  valid input, tree-sitter tree not clean           (A1 both tools accept: reducible; A2 test262-positive that a tool rejects)
//   B  invalid input, tree-sitter tree clean             (B1 both tools: syntax error = grammar; B2 both: early error;
//                                                         B3 tools disagree or both accept = oracle could not tell)
//   C  Babel and oxc disagree (recorded, not judged)
//   ok valid and clean, or invalid and rejected by tree-sitter
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./classify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dir = resolve(args.includes("--dir") ? args[args.indexOf("--dir") + 1] : join(here, "../../build/discovery"));

// split on LF only: readline would also split at U+2028/U+2029, which JSON.stringify leaves unescaped
function* lines(path) {
  for (const l of readFileSync(path, "utf8").split("\n")) if (l) yield JSON.parse(l);
}
const ts = new Map();
for (const r of lines(join(dir, "ts.jsonl"))) ts.set(r.id, r);

const out = [];
const defects = [];
const rejects = [];
const tally = {};
const bump = (k) => (tally[k] = (tally[k] ?? 0) + 1);

for (const rec of lines(join(dir, "oracle.jsonl"))) {
  if (rec.skip) {
    bump(`skipped:${rec.set}`);
    out.push({ id: rec.id, set: rec.set, skip: rec.skip });
    continue;
  }
  const t = ts.get(rec.id);
  if (!t) throw new Error(`no tree-sitter result for ${rec.id}`);
  const { type, cls, bc, oc, truth, cat } = classify(rec, t);
  if (cat === "ok" && cls === "disagree") bump("disagree-but-ok");
  const dir2 = rec.id.startsWith("test262/") ? rec.id.split("/").slice(2, 4).join("/") : rec.pkg;
  const row = {
    id: rec.id, set: rec.set, pkg: rec.pkg, type, truth, cat, babel: bc, oxc: oc,
    bAt: rec.b[type].at ?? null, oAt: rec.o[type].at ?? null, bMsg: rec.b[type].m, oMsg: rec.o[type].m,
    negative: rec.negative, features: rec.features, group: dir2, size: rec.size,
    ts: { err: t.err, clean: t.clean, kind: t.kind, parent: t.parent, start: t.start, row: t.row, col: t.col, txt: t.txt, errors: t.errors, missing: t.missing, zero: t.zero, uncov: t.uncov, timeout: t.timeout },
  };
  out.push(row);
  bump(`${rec.set}:${cat}`);
  bump(`${rec.set}:total`);
  if (cat === "A1") defects.push({ id: rec.id, set: rec.set, type, size: rec.size, prefix: rec.prefix ?? "" });
  if (cat === "B1") rejects.push({ id: rec.id, set: rec.set, type, size: rec.size, prefix: rec.prefix ?? "" });
}

writeFileSync(join(dir, "results.jsonl"), out.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync(join(dir, "defects.jsonl"), defects.map((r) => JSON.stringify(r)).join("\n") + (defects.length ? "\n" : ""));
writeFileSync(join(dir, "rejects.jsonl"), rejects.map((r) => JSON.stringify(r)).join("\n") + (rejects.length ? "\n" : ""));
writeFileSync(join(dir, "summary.json"), JSON.stringify({ tally }, null, 1) + "\n");
console.log(JSON.stringify(tally, null, 1));
