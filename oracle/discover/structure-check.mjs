// One structure comparison of a source: Babel's AST against this grammar's tree (the I/O shell of structure-lib.mjs),
// shared by structure.mjs (workers) and structure-min.mjs (the minimiser predicate).
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startTs } from "./tsserve.mjs";
import { compare, wantedIds } from "./structure-lib.mjs";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../run.mjs")); // the oracle's pinned Babel

// Starts a `tsparse -serve` child (binary `bin`) and returns {ts, check(src, type), close()}.
// check returns {diffs, lists, nb, nt, norm}, or {reject: message} when Babel (no errorRecovery) rejects the source.
export async function makeChecker(bin) {
  const { parse } = require("@babel/parser");
  const ts = startTs(bin);
  const tab = await ts.ask({ kinds: true });
  await ts.ask({ want: wantedIds(tab.kinds) });
  return {
    ts,
    async check(src, type) {
      let file;
      try {
        file = parse(src, { sourceType: type, plugins: ["jsx"], createParenthesizedExpressions: true });
      } catch (e) {
        return { reject: String(e.message).slice(0, 120) };
      }
      const d = await ts.ask({ s: src, x: true });
      return compare(file, src, d.n, tab.kinds, tab.fields);
    },
    close: () => ts.close(),
  };
}
