// The "still shows the original defect" predicates of the minimisers (one per mode), with the tools injected so they are testable.
// `cause` describes the defect of the original input; `test(src, type, cause)` holds while a reduction still shows that cause.
//   accept:    tree-sitter tree not clean with the same first problem node (kind and parent kind), Babel and oxc both accept
//   reject:    tree-sitter has no error, Babel and oxc both report a syntax error, with the same two messages (names ignored)
//              and the same kind of token at oxc's error position
//   structure: tree-sitter tree clean, Babel and oxc both accept, a range mismatch with the same side/family/kind/parent kind remains
// ts(src) -> {e, c, k, p} (tsparse -serve verdict: e has ERROR/MISSING, c clean, k and p kind and parent kind of the first
// problem node); structure(src, type) -> mismatch list. A reduction can still drift to another defect with the same cause: the
// cluster counts are therefore per original input (README.md).
import { KEYWORDS } from "./reduce.mjs";

// names in backticks or quotes ignored, and Babel's trailing ` (line:column)`
export const normMsg = (m) => String(m).replace(/`[^`]*`|'[^']*'|"[^"]*"/g, "_").replace(/\s*\(\d+:\d+\)\s*$/, "");

// The token at a UTF-8 byte offset, by class: keywords and operators or punctuation as they are (`=>` is one token, not `=`),
// `id`, `num`, `ws`, or "" at the end.
export function tokenAt(src, at) {
  if (!Number.isInteger(at)) return "";
  const m = /^(?:([A-Za-z_$\u0080-\uffff][\w$\u0080-\uffff]*)|(\d)|(\s)|(=>|\.\.\.|\?\?=?|\?\.|\*\*=?|&&=?|\|\|=?|>>>?=?|<<=?|[=!]==?|[-+*/%&|^<>]=|\+\+|--|[\s\S]))/.exec(Buffer.from(src).subarray(at, at + 64).toString());
  if (!m) return "";
  return m[1] ? (KEYWORDS.has(m[1]) ? m[1] : "id") : m[2] ? "num" : m[3] ? "ws" : m[4];
}

const problem = (t) => `${t.k}:${t.p}`;
const structureKey = (d) => `${d.side}:${d.f}:${d.kind}:${d.parent}`;

export function makePredicate(mode, { ts, babel, oxc, structure }) {
  if (mode === "reject") {
    const cause = (src, type) => {
      const o = oxc(src, type);
      return `${normMsg(o.m)} | ${normMsg(babel(src, type).m)} | ${tokenAt(src, o.at)}`;
    };
    return {
      cause,
      async test(src, type, want) {
        if ((await ts(src)).e || babel(src, type).c !== "syntax" || oxc(src, type).c !== "syntax") return false;
        return cause(src, type) === want;
      },
    };
  }
  if (mode === "structure") {
    return {
      cause: structureKey,
      async test(src, type, cause) {
        if (!(await ts(src)).c || babel(src, type).c !== "accept" || oxc(src, type).c !== "accept") return false;
        return (await structure(src, type)).some((d) => structureKey(d) === cause);
      },
    };
  }
  return {
    cause: async (src) => problem(await ts(src)),
    async test(src, type, cause) {
      const t = await ts(src);
      if (t.c || problem(t) !== cause) return false;
      return babel(src, type).c === "accept" && oxc(src, type).c === "accept";
    },
  };
}
