// Text reduction shared by minimize.mjs and structure-min.mjs: ddmin over lines, then over tokens, then a simplification
// pass (identifiers to `a`, numbers to 0, strings to "", white space to one character, comments dropped).
// The predicate `test(text)` is async and true while the text still shows the defect.

export async function ddmin(chunks, test, deadline, join) {
  let n = 2;
  while (chunks.length >= 2 && Date.now() < deadline) {
    const size = Math.ceil(chunks.length / n);
    let reduced = false;
    for (let start = 0; start < chunks.length && Date.now() < deadline; start += size) {
      const rest = chunks.slice(0, start).concat(chunks.slice(start + size)); // the complement of one slice
      if (rest.length && (await test(join(rest)))) {
        chunks = rest;
        n = Math.max(n - 1, 2);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (n >= chunks.length) break;
      n = Math.min(chunks.length, n * 2);
    }
  }
  return chunks;
}

export const TOKEN = /\s+|[A-Za-z_$\u0080-￿][\w$\u0080-￿]*|\d[\w.]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[\s\S]/g;

export const KEYWORDS = new Set("async await break case catch class const continue debugger default delete do else enum export extends false finally for function get if implements import in instanceof interface let new null of package private protected public return set static super switch this throw true try typeof using var void while with yield accessor from as".split(" "));

// Returns the reduced text; `src` must satisfy `test`. errRow: the 0-based row of the first problem, to cut a window
// around it first for big files (cut points need not be valid).
export async function reduce(src, test, { budgetMs = 60000, errRow = 0 } = {}) {
  const deadline = Date.now() + budgetMs;
  let lines = src.split("\n");
  if (src.length > 4000) {
    for (const w of [40, 200, 1000, 5000]) {
      if (2 * w >= lines.length) break;
      const lo = Math.max(0, errRow - w);
      const cand = lines.slice(lo, errRow + w).join("\n");
      if (await test(cand)) { lines = cand.split("\n"); break; }
    }
  }
  lines = await ddmin(lines, test, deadline, (c) => c.join("\n"));
  let toks = lines.join("\n").match(TOKEN) ?? [];
  toks = await ddmin(toks, test, deadline, (c) => c.join(""));
  toks = (toks.join("").match(TOKEN) ?? []);
  const same = (i, repl) => toks.slice(0, i).join("") + repl + toks.slice(i + 1).join("");
  for (let i = 0; i < toks.length && Date.now() < deadline; i++) {
    const t = toks[i];
    let repl = null;
    if (/^\s+$/.test(t)) repl = t.includes("\n") ? "\n" : " ";
    else if (/^[A-Za-z_$\u0080-￿]/.test(t) && !/^(a|[bcd])$/.test(t) && !KEYWORDS.has(t)) repl = "a";
    else if (/^\d/.test(t) && t !== "0") repl = "0";
    else if (/^["']/.test(t) && t.length > 2) repl = t[0] + t[0];
    else if (/^\/\//.test(t) || /^\/\*/.test(t)) repl = "";
    if (repl !== null && repl !== t && (await test(same(i, repl)))) toks[i] = repl;
  }
  let cur = toks.join("");
  if (cur !== cur.trim() && (await test(cur.trim()))) cur = cur.trim(); // leading white space can be the defect itself
  return cur;
}
