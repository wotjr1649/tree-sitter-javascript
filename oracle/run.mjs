// Verdict runner: reads oracle/cases.jsonl, asks @babel/parser and oxc-parser about every case and writes
// oracle/verdicts.json. See oracle/README.md. Exit codes: 0 done; 2 inconsistent inputs (nothing written).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as babelParse } from "@babel/parser";
import { parseSync as oxcParse } from "oxc-parser";

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const fail = (msg) => {
  console.error(`run.mjs: ${msg}`);
  process.exit(2);
};

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i < 0 ? dflt : args[i + 1] ?? fail(`${name} needs a value`);
};
const casesPath = flag("--cases", join(here, "cases.jsonl"));
const outPath = flag("--out", join(here, "verdicts.json"));
const lockPath = join(here, "package-lock.json");

const TOOLS = [
  ["babel", "@babel/parser", "8.1.2"],
  ["oxc", "oxc-parser", "0.159.0"],
];
const KEYS = ["id", "sha256", "source", "sourceType", "expect", "errorAt", "reason"];

// ---- cases ---------------------------------------------------------------------------------------------------------
const casesBytes = readFileSync(casesPath);
const cases = casesBytes
  .toString("utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l, n) => {
    let c;
    try {
      c = JSON.parse(l);
    } catch (e) {
      fail(`${basename(casesPath)}:${n + 1}: ${e.message}`);
    }
    if (c === null || typeof c !== "object" || Array.isArray(c)) fail(`${basename(casesPath)}:${n + 1}: a record must be a JSON object`);
    for (const k of Object.keys(c)) if (!KEYS.includes(k)) fail(`${basename(casesPath)}:${n + 1}: unknown field ${k}`);
    return c;
  });

if (cases.length === 0) fail(`${basename(casesPath)} has no cases`);

if (args.includes("--rehash")) {
  // Fill in or fix `sha256` and write the file in the canonical form (one record per line, fixed key order).
  const out = cases.map((c) => {
    if (typeof c.source !== "string") fail(`${c.id}: source must be a string`);
    c.sha256 = sha256(Buffer.from(c.source, "utf8"));
    c.sourceType ??= "module";
    return JSON.stringify(Object.fromEntries(KEYS.filter((k) => k in c).map((k) => [k, c[k]])));
  });
  writeFileSync(casesPath, out.join("\n") + "\n");
  console.log(`rehashed ${out.length} cases`);
  process.exit(0);
}

const seen = new Set();
for (const c of cases) {
  if (typeof c.id !== "string" || c.id === "" || seen.has(c.id)) fail(`bad or duplicate id ${JSON.stringify(c.id)}`);
  seen.add(c.id);
  if (typeof c.source !== "string") fail(`${c.id}: source must be a string`);
  if (c.sha256 !== sha256(Buffer.from(c.source, "utf8"))) fail(`${c.id}: sha256 does not match source (run --rehash)`);
  c.sourceType ??= "module";
  if (c.sourceType !== "module" && c.sourceType !== "script") fail(`${c.id}: sourceType must be module or script`);
}

// ---- tools: installed versions must equal the pins and the lockfile ------------------------------------------------
const lock = JSON.parse(readFileSync(lockPath, "utf8")).packages;
const meta = { format: 1, encoding: "utf-8", offsets: "UTF-8 byte offsets", tools: {} };
for (const [key, pkg, version] of TOOLS) {
  const installed = JSON.parse(readFileSync(join(here, "node_modules", pkg, "package.json"), "utf8")).version;
  const entry = lock[`node_modules/${pkg}`];
  if (installed !== version || entry?.version !== version) fail(`${pkg}: installed ${installed}, lock ${entry?.version}, pin ${version}`);
  meta.tools[key] = { package: pkg, version, integrity: entry.integrity };
}
meta.tools.babel.options = { sourceType: "per case", plugins: ["jsx", "decorators"], errorRecovery: true };
meta.tools.oxc.options = { filename: "oracle.jsx", lang: "jsx", sourceType: "per case", showSemanticErrors: [false, true] };
meta.cases_file = basename(casesPath);
meta.cases_sha256 = sha256(casesBytes);
meta.runner = basename(fileURLToPath(import.meta.url));
meta.runner_sha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));

// ---- verdicts --------------------------------------------------------------------------------------------------------
// Both tools report UTF-16 offsets; the verdict file records UTF-8 byte offsets (the tree-sitter unit).
const byteAt = (src, utf16) => (Number.isInteger(utf16) ? Buffer.byteLength(src.slice(0, utf16), "utf8") : null);

function babel(c) {
  try {
    const ast = babelParse(c.source, { sourceType: c.sourceType, plugins: ["jsx", "decorators"], errorRecovery: true });
    const errors = ast.errors.map((e) => ({ message: e.message, at: byteAt(c.source, e.pos) }));
    return { class: errors.length ? "early" : "accept", errors };
  } catch (e) {
    return { class: "syntax", errors: [{ message: e.message, at: byteAt(c.source, e.pos) }] };
  }
}

function oxc(c) {
  const run = (showSemanticErrors) =>
    oxcParse("oracle.jsx", c.source, { lang: "jsx", sourceType: c.sourceType, showSemanticErrors })
      .errors.filter((e) => e.severity === "Error")
      .map((e) => ({ message: e.message, at: byteAt(c.source, e.labels?.[0]?.start) }));
  const syntax = run(false);
  const all = run(true);
  return { class: syntax.length ? "syntax" : all.length ? "early" : "accept", errors: syntax, errorsWithSemantic: all };
}

const results = cases.map((c) => {
  const b = babel(c);
  const o = oxc(c);
  return {
    id: c.id,
    sha256: c.sha256,
    sourceType: c.sourceType,
    verdict: b.class === o.class ? b.class : "disagree",
    babel: b,
    oxc: o,
  };
});

writeFileSync(outPath, JSON.stringify({ meta, results }, null, 1) + "\n");
const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
console.log(`wrote ${basename(outPath)}: ${results.length} cases`, JSON.stringify(tally));
