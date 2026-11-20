// Ad-hoc check of short sources against Babel, oxc and this grammar (for confirming and generalising a reproducer).
//   node probe.mjs [--type module|script] [--tree] [--tsparse BIN] FILE    FILE holds one JSON string per line, or a JSON array
// --tree prints the S-expression first. Prints one line per source: Babel and oxc class, tree-sitter result with the first problem node, the escaped source.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { babel, oxc } from "./tools.mjs";
import { startTs } from "./tsserve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const type = flag("--type", "script");
const bin = resolve(flag("--tsparse", join(here, "../../build/discovery/tsparse.exe")));
const file = args.filter((a, i) => !a.startsWith("--") && !["--type", "--tsparse"].includes(args[i - 1])).pop();
const text = readFileSync(file, "utf8").trim();
const sources = text.startsWith("[") ? JSON.parse(text) : text.split("\n").filter(Boolean).map((l) => JSON.parse(l));

const ts = startTs(bin);
const withTree = args.includes("--tree");
const ask = (s) => ts.ask({ s, t: withTree });
const esc = (s) => s.replace(/[^\x20-\x7e]/g, (c) => "\\u{" + c.codePointAt(0).toString(16) + "}");

for (const s of sources) {
  const t = await ask(s);
  if (withTree && t.t) console.log("   " + t.t);
  console.log(`babel=${babel(s, type).c.padEnd(6)} oxc=${oxc(s, type).c.padEnd(6)} ts=${t.c ? "clean" : t.e ? `ERROR@${t.at}(${t.k})` : "defect"}  ${esc(s)}`);
}
ts.close();
