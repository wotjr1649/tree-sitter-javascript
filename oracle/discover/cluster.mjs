// Step 5: group the minimal reproducers by root cause with cluster-rules.json; write clusters.json and clusters.md.
//   node cluster.mjs [--dir build/discovery]
// Reads DIR/min.jsonl (A1, valid input that tree-sitter does not parse clean), DIR/min-reject.jsonl (B1, grammar
// errors that tree-sitter accepts) and DIR/min-structure.jsonl (S, valid input with a clean tree whose ranges disagree with Babel). A reproducer goes to the first rule whose regular expression matches its text; the
// rest are listed as `other`, grouped by identical text. The rules are the author's judgement (README.md). Counts are per original
// input (a reduction can drift to another defect of the same kind), so a cluster is a candidate cause, not a confirmed one.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dir = resolve(args.includes("--dir") ? args[args.indexOf("--dir") + 1] : join(here, "../../build/discovery"));
const rules = JSON.parse(readFileSync(join(here, "cluster-rules.json"), "utf8"));
const jsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const esc = (s) => s.replace(/[^\x20-\x7e]/g, (c) => "\\u{" + c.codePointAt(0).toString(16) + "}");
const short = (id) => id.replace(/^test262\/test\//, "t262:").replace(/^babel-fixtures\/packages\/babel-parser\/test\/fixtures\/jsx\//, "babel-jsx:").replace(/^pkgs\//, "npm:");

const out = [];
for (const [kind, file, ruleList] of [["accept", "min.jsonl", rules.accept], ["reject", "min-reject.jsonl", rules.reject], ["structure", "min-structure.jsonl", rules.structure ?? []]]) {
  const rows = jsonl(join(dir, file));
  const clusters = new Map();
  for (const r of rows) {
    const rule = r.ok ? ruleList.find((x) => new RegExp(x.re).test(r.min)) : null;
    const id = rule?.id ?? (r.ok ? `other: ${esc(r.min.replace(/\s+/g, " ").trim()).slice(0, 60)}` : "not reduced");
    const c = clusters.get(id) ?? { kind, id, rule, count: 0, sets: {}, repros: new Map(), examples: [] };
    c.count++;
    c.sets[r.set] = (c.sets[r.set] ?? 0) + 1;
    c.repros.set(r.min, (c.repros.get(r.min) ?? 0) + 1);
    if (c.examples.length < 3) c.examples.push(short(r.id));
    clusters.set(id, c);
  }
  for (const c of clusters.values()) {
    const top = [...c.repros.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => esc(s));
    out.push({ kind, id: c.id, count: c.count, sets: c.sets, construct: c.rule?.construct ?? "(no rule yet)", issues: c.rule?.issues ?? [], tree_change: c.rule?.tree_change ?? "?", difficulty: c.rule?.difficulty ?? "?", reproducers: top, examples: c.examples });
  }
}
out.sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind < b.kind ? -1 : 1));
writeFileSync(join(dir, "clusters.json"), JSON.stringify(out, null, 1) + "\n");
const md = ["Counts are per original input, and a cluster is a candidate cause: the reproducer of an input is a reduction under a predicate that keeps the original's cause (README.md), but a reduction can still drift to another defect. Treat a count as a number of inputs, not of confirmed distinct causes, until the originals have been checked against their reproducers."];
const TITLE = { accept: "A1: valid input, tree-sitter not clean", reject: "B1: grammar error accepted by tree-sitter", structure: "S: valid input, clean tree, but Babel and the tree disagree on a range (structure.mjs)" };
for (const kind of ["accept", "reject", "structure"]) {
  if (!out.some((x) => x.kind === kind)) continue;
  md.push(`\n## ${TITLE[kind]}\n`);
  md.push("| count | cluster | construct | reproducers | issues | tree change | difficulty |", "|---:|---|---|---|---|---|---|");
  for (const c of out.filter((x) => x.kind === kind)) {
    md.push(`| ${c.count} | ${c.id} | ${c.construct} | ${c.reproducers.map((s) => "`" + s.replace(/\|/g, "\\|") + "`").join(" ")} | ${c.issues.join(", ")} | ${c.tree_change} | ${c.difficulty} |`);
  }
}
writeFileSync(join(dir, "clusters.md"), md.join("\n") + "\n");
console.log(`${out.length} clusters; ${out.filter((c) => c.id.startsWith("other") || c.id === "not reduced").length} without a rule; clusters.json and clusters.md written`);
for (const c of out) console.log(String(c.count).padStart(4), c.kind.padEnd(6), c.id);
