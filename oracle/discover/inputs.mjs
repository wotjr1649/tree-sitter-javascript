import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// test/corpus/*.txt: `====` name `====` input `---` expected tree; the attribute line `:error` marks inputs that must not parse.
export function corpusInputs(dir) {
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".txt")).sort()) {
    const text = readFileSync(join(dir, f), "utf8").replaceAll("\r\n", "\n");
    const re = /^={3,}\n([^\n]*)\n((?::[^\n]*\n)*)={3,}\n([\s\S]*?)\n---+\n/gm;
    let m;
    while ((m = re.exec(text))) if (!/:error/.test(m[2])) out.push({ id: `corpus/${f}/${m[1]}`, set: "corpus", text: m[3] + "\n" });
  }
  return out;
}

// id -> prefix (`"use strict";\n` for test262 onlyStrict tests) from oracle.jsonl, for the inputs that have one.
export function readPrefixes(oraclePath) {
  const prefix = new Map();
  for (const l of readFileSync(oraclePath, "utf8").split("\n")) {
    if (!l) continue;
    const r = JSON.parse(l);
    if (r.prefix) prefix.set(r.id, r.prefix);
  }
  return prefix;
}

// The text of a discovery input, only when its bytes are the ones collect.mjs judged (the sha256 of its record): a changed or
// unreadable file is an error here, never a parser result.
export function readVerified(path, sha256) {
  if (!sha256) throw new Error(`no sha256 recorded for ${path}; run collect and analyze again`);
  const buf = readFileSync(path);
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== sha256) throw new Error(`sha256 ${got} differs from the collected ${sha256}`);
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf);
}
