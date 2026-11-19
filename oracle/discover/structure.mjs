// Structure run: valid inputs on which this grammar's tree is clean, compared with Babel's AST by ranges (see structure-lib.mjs).
//   node structure.mjs [--results FILE] [--data DIR] [--out FILE] [--tsparse BIN] [--workers 1|2|3] [--max-bytes N] [--limit N]
//                      [--corpus DIR] [--files FILE...]
// Default input: the valid, clean inputs of DIR/results.jsonl (analyze.mjs): test262 positives, and the other sets' inputs
// that Babel and oxc both accept. --corpus takes the `test/corpus/*.txt` inputs (no `:error`, both tools accept), --files plain
// source files (the source type is the first one both tools accept). Babel runs without errorRecovery; an input it rejects
// is counted, not compared, and so is an input whose tree is not clean (the same condition on every input path). A file of
// DIR must still have the sha256 that collect.mjs recorded (an input that does not is "input-error", exit code 3). Writes one JSON line per input that has a mismatch to OUT (structure.jsonl) and a summary to
// OUT's `.summary.json`. Heavy job on the shared machine: take a slot, 3 workers at most (one Node thread and one
// `tsparse -serve` child each).
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { makeChecker } from "./structure-check.mjs";
import { babel, oxc } from "./tools.mjs";
import { corpusInputs, readPrefixes, readVerified } from "./inputs.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// ---- one input (worker side) ---------------------------------------------------------------------------------------
async function worker() {
  const checker = await makeChecker(workerData.bin);
  parentPort.on("message", async (job) => {
    if (job === null) return checker.close(), process.exit(0);
    const { id, set, type, size, sha256 } = job;
    const base = { id, set, type, size, sha256 };
    let src;
    try {
      src = job.text ?? job.prefix + readVerified(join(workerData.data, id), sha256);
    } catch (e) {
      return parentPort.postMessage({ ...base, status: "input-error", msg: e.message });
    }
    const r = await checker.check(src, type);
    if (r.reject) return parentPort.postMessage({ ...base, status: "babel-reject", msg: r.reject });
    if (r.notClean) return parentPort.postMessage({ ...base, status: "not-clean" });
    const bad = r.diffs.length || r.lists.length;
    parentPort.postMessage({ ...base, status: bad ? "diff" : "ok", nb: r.nb, nt: r.nt, norm: r.norm, nd: r.diffs.length, diffs: r.diffs.slice(0, 40), lists: r.lists.slice(0, 10) });
  });
  parentPort.postMessage({ ready: true });
}

// ---- inputs --------------------------------------------------------------------------------------------------------
function typeFor(text) {
  for (const t of ["script", "module"]) if (babel(text, t).c === "accept" && oxc(text, t).c === "accept") return t;
  return null;
}

// ---- main ----------------------------------------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
  const dir = join(here, "../../build/structure");
  const results = resolve(flag("--results", join(here, "../../build/discovery/results.jsonl")));
  const data = resolve(flag("--data", join(here, "../../build/discovery/data")));
  const out = resolve(flag("--out", join(dir, "structure.jsonl")));
  const bin = resolve(flag("--tsparse", join(dir, "tsparse.exe")));
  const nWorkers = Number(flag("--workers", "3"));
  const maxBytes = Number(flag("--max-bytes", String(4 * 1024 * 1024)));
  const limit = Number(flag("--limit", "0"));
  if (![1, 2, 3].includes(nWorkers)) throw new Error("--workers must be 1, 2 or 3 (RESOURCES.md)");
  if (!(Number.isInteger(maxBytes) && maxBytes > 0) || !(Number.isInteger(limit) && limit >= 0)) throw new Error("--max-bytes must be a positive integer, --limit a non-negative one");
  const tooBig = () => (skipped["too-big"] = (skipped["too-big"] ?? 0) + 1);

  const jobs = [];
  const skipped = {};
  if (args.includes("--corpus")) {
    for (const j of corpusInputs(resolve(flag("--corpus")))) {
      const size = Buffer.byteLength(j.text);
      if (size > maxBytes) { tooBig(); continue; }
      const type = typeFor(j.text);
      if (type) jobs.push({ ...j, type, size, prefix: "" });
      else skipped["corpus-tools-disagree"] = (skipped["corpus-tools-disagree"] ?? 0) + 1;
    }
  } else if (args.includes("--files")) {
    for (const f of args.slice(args.indexOf("--files") + 1).filter((a) => !a.startsWith("--"))) {
      if (statSync(f).size > maxBytes) { tooBig(); continue; }
      const text = readFileSync(f, "utf8");
      const type = typeFor(text);
      if (type) jobs.push({ id: f, set: "files", text, type, size: Buffer.byteLength(text), prefix: "" });
      else skipped["files-tools-disagree"] = (skipped["files-tools-disagree"] ?? 0) + 1;
    }
  } else {
    const prefix = readPrefixes(join(dirname(results), "oracle.jsonl"));
    for (const l of readFileSync(results, "utf8").split("\n")) {
      if (!l) continue;
      const r = JSON.parse(l);
      if (r.skip) continue;
      if (r.truth !== "valid" || !r.ts.clean) { skipped["not-valid-or-not-clean"] = (skipped["not-valid-or-not-clean"] ?? 0) + 1; continue; }
      if (r.set !== "test262" && !(r.babel === "accept" && r.oxc === "accept")) { skipped["tools-disagree"] = (skipped["tools-disagree"] ?? 0) + 1; continue; }
      if (r.size > maxBytes) { tooBig(); continue; }
      jobs.push({ id: r.id, set: r.set, type: r.type, size: r.size, sha256: r.sha256, prefix: prefix.get(r.id) ?? "" });
    }
  }
  if (limit) jobs.length = Math.min(jobs.length, limit);

  writeFileSync(out, "");
  const tally = {};
  const norm = {};
  const bump = (k) => (tally[k] = (tally[k] ?? 0) + 1);
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  await new Promise((resolveAll) => {
    let alive = nWorkers;
    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { bin, data }, resourceLimits: { maxOldGenerationSizeMb: 2048 } });
      const feed = () => (next < jobs.length ? w.postMessage(jobs[next++]) : (w.postMessage(null), (--alive === 0 && resolveAll())));
      w.on("message", (m) => {
        if (!m.ready) {
          bump(`${m.set}:${m.status}`);
          bump(`${m.set}:total`);
          for (const [k, v] of Object.entries(m.norm ?? {})) norm[k] = (norm[k] ?? 0) + v;
          if (m.status !== "ok") appendFileSync(out, JSON.stringify(m) + "\n");
          if (++done % 5000 === 0) console.error(`${done}/${jobs.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        }
        feed();
      });
      w.on("error", (e) => { console.error("worker failed:", e); process.exit(1); });
    }
  });
  // workers finish in any order: sort by id so the file is the same on every run
  writeFileSync(out, readFileSync(out, "utf8").split("\n").filter(Boolean).sort((a, b) => (JSON.parse(a).id < JSON.parse(b).id ? -1 : 1)).map((l) => l + "\n").join(""));
  const summary = { inputs: jobs.length, skipped, tally, norm, seconds: Math.round((Date.now() - t0) / 1000) };
  writeFileSync(out.replace(/\.jsonl$/, "") + ".summary.json", JSON.stringify(summary, null, 1) + "\n");
  console.log(JSON.stringify(summary));
  const bad = Object.entries(tally).filter(([k]) => k.endsWith(":input-error")).reduce((n, [, v]) => n + v, 0);
  if (bad) { console.error(`structure: ${bad} inputs were unreadable or changed since collect (input-error); fetch and collect again`); process.exitCode = 3; }
}

if (isMainThread) await main();
else await worker();
