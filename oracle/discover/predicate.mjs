// The "still shows the defect" predicates of the minimisers (one per mode), with the tools injected so they are testable.
//   accept:    tree-sitter tree not clean, Babel and oxc both accept            (a valid input this grammar fails on)
//   reject:    tree-sitter has no error, Babel and oxc both report a syntax error with oxc's message unchanged
//   structure: tree-sitter tree clean, Babel and oxc both accept, and a range mismatch with the same side/family/kind remains
// ts(src) -> {e, c} (tsparse -serve verdict: e has ERROR/MISSING, c clean); structure(src, type) -> mismatch list.

export const normMsg = (m) => String(m).replace(/`[^`]*`|'[^']*'/g, "_"); // names in backticks or quotes ignored

export function makePredicate(mode, { ts, babel, oxc, structure }) {
  if (mode === "reject") {
    return {
      // a reduction must keep oxc's error, or the text drifts to a different grammar error
      cause: (src, type) => normMsg(oxc(src, type).m),
      async test(src, type, cause) {
        if ((await ts(src)).e || babel(src, type).c !== "syntax") return false;
        const o = oxc(src, type);
        return o.c === "syntax" && normMsg(o.m) === cause;
      },
    };
  }
  if (mode === "structure") {
    return {
      cause: (diff) => `${diff.side}:${diff.f}:${diff.kind}`,
      async test(src, type, cause) {
        if (!(await ts(src)).c || babel(src, type).c !== "accept" || oxc(src, type).c !== "accept") return false;
        return (await structure(src, type)).some((d) => `${d.side}:${d.f}:${d.kind}` === cause);
      },
    };
  }
  return {
    cause: () => null,
    async test(src, type) {
      if ((await ts(src)).c) return false;
      return babel(src, type).c === "accept" && oxc(src, type).c === "accept";
    },
  };
}
