// Tables for the report: counts per set, test262 root, skip reason and npm package. Reads build/discovery/results.jsonl.
//   node stats.mjs [--dir build/discovery]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readVerified } from "./inputs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dir = resolve(args.includes("--dir") ? args[args.indexOf("--dir") + 1] : join(here, "../../build/discovery"));
const jsonl = (f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const res = jsonl("results.jsonl");
const data = join(dir, "data");
const inc = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
const stats = { sets: {}, test262Roots: {}, skipReasons: {}, packages: {}, inputErrors: [] };

for (const r of res) {
  if (r.skip) { inc(stats.skipReasons, r.skip.replace(/:.*/, "")); continue; }
  const s = (stats.sets[r.set] ??= { inputs: 0, bytes: 0, valid: 0, invalid: 0, unknown: 0, A1: 0, A2: 0, B1: 0, B2: 0, B3: 0, C: 0, T: 0, X: 0, ok: 0 });
  s.inputs++; s.bytes += r.size; s[r.truth]++; s[r.cat]++;
  if (r.set === "test262") {
    const root = r.id.split("/").slice(1, 3).join("/");
    const t = (stats.test262Roots[root] ??= { inputs: 0, A1: 0, A2: 0, B1: 0, B2: 0, B3: 0, C: 0, T: 0, X: 0, ok: 0 });
    t.inputs++; t[r.cat]++;
  }
  if (r.set === "npm") {
    const p = (stats.packages[r.pkg] ??= { files: 0, bytes: 0, valid: 0, invalid: 0, unknown: 0, jsxLike: 0, clean: 0, invalidFiles: [] });
    p.files++; p.bytes += r.size; p[r.truth]++;
    if (r.ts.clean) p.clean++;
    if (r.truth === "invalid") p.invalidFiles.push(r.id.replace(/^pkgs\/[^/]+\/package\//, ""));
    if (r.size >= 3_000_000) continue;
    // the bytes collect judged, or an input error: a file changed since then must not change the count
    let text;
    try { text = readVerified(join(data, r.id), r.sha256); } catch (e) { stats.inputErrors.push(`${r.id}: ${e.message}`); continue; }
    if (/<[A-Z][A-Za-z0-9.]*(\s|>|\/)[^<]*(\/>|<\/)/.test(text)) p.jsxLike++;
  }
}
writeFileSync(join(dir, "stats.json"), JSON.stringify(stats, null, 1) + "\n");
console.log(JSON.stringify({ sets: stats.sets, skipReasons: stats.skipReasons, test262Roots: stats.test262Roots }, null, 1));
for (const [k, v] of Object.entries(stats.packages)) console.log(k.padEnd(28), `files ${v.files}`.padEnd(12), `${(v.bytes / 1e6).toFixed(1)} MB`.padEnd(10), `valid ${v.valid}`.padEnd(11), `invalid ${v.invalid}`.padEnd(11), `jsx-like ${v.jsxLike}`, v.invalidFiles.slice(0, 3).join(" "));
if (stats.inputErrors.length) {
  console.error(`stats: ${stats.inputErrors.length} npm inputs were unreadable or changed since collect (not counted in jsxLike, listed in stats.json inputErrors); fetch and collect again\n  ${stats.inputErrors.slice(0, 3).join("\n  ")}`);
  process.exit(3);
}
