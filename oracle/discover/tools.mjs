// Babel and oxc verdicts for one source, with the options of oracle/run.mjs (the oracle's pins in ../package.json).
// Class: accept (no error), early (only recoverable/semantic errors), syntax (a parse error).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../run.mjs")); // resolve the tools from oracle/node_modules
const { parse: babelParse } = require("@babel/parser");
const { parseSync: oxcParse } = require("oxc-parser");

const bytePos = (src, u16) => (Number.isInteger(u16) ? Buffer.byteLength(src.slice(0, u16), "utf8") : null);
export function babel(src, sourceType) {
  try {
    const ast = babelParse(src, { sourceType, plugins: ["jsx"], errorRecovery: true });
    const e = ast.errors[0];
    return e ? { c: "early", at: bytePos(src, e.pos), m: e.message.slice(0, 160), n: ast.errors.length } : { c: "accept" };
  } catch (e) {
    return { c: "syntax", at: bytePos(src, e.pos), m: String(e.message).slice(0, 160) };
  }
}
export function oxc(src, sourceType) {
  const run = (showSemanticErrors) => {
    try {
      return oxcParse("oracle.jsx", src, { lang: "jsx", sourceType, showSemanticErrors }).errors.filter((e) => e.severity === "Error");
    } catch (e) {
      return [{ message: "oxc threw: " + e.message, labels: [] }];
    }
  };
  const syn = run(false);
  if (syn.length) return { c: "syntax", at: bytePos(src, syn[0].labels?.[0]?.start), m: syn[0].message.slice(0, 160) };
  const all = run(true);
  return all.length ? { c: "early", at: bytePos(src, all[0].labels?.[0]?.start), m: all[0].message.slice(0, 160), n: all.length } : { c: "accept" };
}
