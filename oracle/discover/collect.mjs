// Step 1 of the discovery run: enumerate the inputs and ask Babel and oxc about each one.
//   node collect.mjs [--data DIR] [--out FILE] [--only test262|npm] [--limit N]
// Writes one JSON record per input to FILE (default build/discovery/oracle.jsonl); see README.md for the fields.
// Tool versions and options are those of ../package.json and ../run.mjs (the oracle's pins), so the two stay one oracle.
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { babel, oxc } from "./tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const data = resolve(flag("--data", join(here, "../../build/discovery/data")));
const outPath = resolve(flag("--out", join(here, "../../build/discovery/oracle.jsonl")));
const only = flag("--only", "");
const limit = Number(flag("--limit", "0"));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const MAX_BYTES = 16 * 1024 * 1024;

// ---- walk ----------------------------------------------------------------------------------------------------------
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

// ---- test262 -------------------------------------------------------------------------------------------------------
const t262 = join(data, "test262");
const unstable = new Set();
{
  const lines = readFileSync(join(t262, "features.txt"), "utf8").split("\n");
  const stop = lines.findIndex((l) => l.startsWith("## Standard language features"));
  for (const l of lines.slice(0, stop)) {
    const m = /^([A-Za-z][\w.\-]*)\s*(#.*)?$/.exec(l);
    if (m) unstable.add(m[1]);
  }
}

// The front matter is YAML between /*--- and ---*/; only `flags`, `features` and `negative` matter here.
function frontMatter(text) {
  const m = /\/\*---([\s\S]*?)---\*\//.exec(text);
  const fm = { flags: [], features: [], negative: null, has: !!m };
  if (!m) return fm;
  const body = m[1];
  const list = (key) => {
    const inline = new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, "m").exec(body);
    if (inline) return inline[1].split(",").map((s) => s.trim()).filter(Boolean);
    const block = new RegExp(`^${key}:\\s*\\n((?:[ \\t]+-[^\\n]*\\n?)+)`, "m").exec(body);
    return block ? block[1].split("\n").map((s) => s.replace(/^\s*-\s*/, "").trim()).filter(Boolean) : [];
  };
  fm.flags = list("flags");
  fm.features = list("features");
  const neg = /^negative:\s*\n((?:[ \t]+[^\n]*\n?)+)/m.exec(body);
  if (neg) fm.negative = { phase: /phase:\s*(\w+)/.exec(neg[1])?.[1] ?? null, type: /type:\s*(\w+)/.exec(neg[1])?.[1] ?? null };
  return fm;
}

function* test262Inputs() {
  for (const root of manifest.test262.roots) {
    for (const p of walk(join(t262, root))) {
      if (!p.endsWith(".js")) continue;
      yield { set: "test262", abs: p, rel: relative(data, p).replaceAll("\\", "/") };
    }
  }
}

// ---- Babel's JSX fixtures --------------------------------------------------------------------------------------------
function* babelJsxInputs() {
  const root = join(data, "babel-fixtures", manifest.babel_jsx.path);
  if (!existsSync(root)) return;
  for (const p of walk(root)) {
    if (!/\/input\.(js|jsx|mjs)$/.test(p.replaceAll("\\", "/"))) continue;
    yield { set: "babel-jsx", abs: p, rel: relative(data, p).replaceAll("\\", "/") };
  }
}

// ---- npm -----------------------------------------------------------------------------------------------------------
function* npmInputs() {
  for (const pkg of manifest.packages) {
    const root = join(data, "pkgs", `${pkg.name.replace(/^@/, "").replace("/", "__")}-${pkg.version}`, "package");
    if (!existsSync(root)) continue;
    for (const p of walk(root)) {
      if (!/\.(js|jsx|mjs|cjs)$/.test(p)) continue;
      const inPkg = relative(root, p).replaceAll("\\", "/");
      if (pkg.include && !pkg.include.some((i) => inPkg.startsWith(i))) continue;
      yield { set: "npm", pkg: `${pkg.name}@${pkg.version}`, abs: p, rel: relative(data, p).replaceAll("\\", "/"), inPkg };
    }
  }
}

// ---- one input -----------------------------------------------------------------------------------------------------
function describe(inp) {
  const rec = { id: inp.rel, set: inp.set };
  if (inp.pkg) rec.pkg = inp.pkg;
  const size = statSync(inp.abs).size;
  rec.size = size;
  if (size > MAX_BYTES) return { ...rec, skip: "larger than 16 MiB" };
  const buf = readFileSync(inp.abs);
  rec.sha256 = sha256(buf);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    return { ...rec, skip: "not valid UTF-8" };
  }

  let prefix = "";
  let types;
  if (inp.set === "test262") {
    const fm = frontMatter(text);
    const fixture = /_FIXTURE\.js$/.test(inp.abs);
    rec.flags = fm.flags;
    rec.features = fm.features;
    const skipF = fm.features.filter((f) => unstable.has(f));
    if (skipF.length) return { ...rec, skip: `stage 3 or earlier feature: ${skipF.join(",")}` };
    if (fixture) {
      // fixtures have no front matter, so the feature filter above cannot see stage 3 syntax in them
      if (/\bimport\s+(defer|source)\b|\bexport\s+defer\b/.test(text)) return { ...rec, skip: "fixture with stage 3 syntax (import defer/source)" };
      Object.assign(rec, { truth: "unknown", type: "module" });
      types = ["module"];
    } else {
      rec.truth = fm.negative?.phase === "parse" ? "invalid" : "valid";
      if (fm.negative) rec.negative = fm.negative;
      const type = fm.flags.includes("module") ? "module" : "script";
      rec.type = type;
      types = [type];
      if (fm.flags.includes("onlyStrict") && type === "script") prefix = '"use strict";\n';
    }
  } else if (inp.set === "babel-jsx") {
    rec.truth = "unknown";
    types = ["module", "script"]; // the fixtures say their source type in an options.json this tool does not read
  } else {
    rec.truth = "unknown";
    types = inp.abs.endsWith(".mjs") ? ["module"] : inp.abs.endsWith(".cjs") ? ["script"] : ["script", "module"];
    rec.minified = /\.min\.js$/.test(inp.abs) || undefined;
  }
  if (prefix) rec.prefix = prefix;
  const src = prefix + text;
  const shift = Buffer.byteLength(prefix, "utf8");
  const fix = (r) => (r.at == null ? r : { ...r, at: Math.max(0, r.at - shift) });
  rec.b = {};
  rec.o = {};
  for (const t of types) {
    rec.b[t] = fix(babel(src, t));
    rec.o[t] = fix(oxc(src, t));
  }
  return rec;
}

// ---- main ----------------------------------------------------------------------------------------------------------
const out = createWriteStream(outPath);
let n = 0;
const t0 = Date.now();
const tally = {};
for (const gen of [test262Inputs, babelJsxInputs, npmInputs]) {
  for (const inp of gen()) {
    if (only && inp.set !== only) continue;
    if (limit && n >= limit) break;
    const rec = describe(inp);
    out.write(JSON.stringify(rec) + "\n");
    n++;
    tally[rec.skip ? "skip" : rec.set] = (tally[rec.skip ? "skip" : rec.set] ?? 0) + 1;
    if (n % 5000 === 0) console.error(`${n} inputs, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
await new Promise((r) => out.end(r));
console.log(`collect: ${n} inputs`, JSON.stringify(tally), `${((Date.now() - t0) / 1000).toFixed(0)} s`, `${unstable.size} unstable features`);
