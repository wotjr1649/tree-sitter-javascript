import test from "node:test";
import assert from "node:assert/strict";
import { makePredicate, normMsg, tokenAt } from "../predicate.mjs";
import { ddmin, reduce, TOKEN } from "../reduce.mjs";

const cls = (c, m) => () => ({ c, m });
const clsAt = (c, m, at) => () => ({ c, m, at });

test("accept mode: tree not clean with the original's first problem node, and both tools accept", async () => {
  const p = (ts, b, o) => makePredicate("accept", { ts: async () => ts, babel: cls(b), oxc: cls(o) });
  const err = { c: false, k: "ERROR", p: "program" };
  const cause = await p(err, "accept", "accept").cause("x");
  assert.equal(cause, "ERROR:program");
  assert.equal(await p(err, "accept", "accept").test("x", "script", cause), true);
  assert.equal(await p({ c: true }, "accept", "accept").test("x", "script", cause), false, "a clean tree is not a defect");
  assert.equal(await p(err, "accept", "early").test("x", "script", cause), false, "a reproducer must stay valid");
  assert.equal(await p({ ...err, k: 'MISSING ";"' }, "accept", "accept").test("x", "script", cause), false, "another kind of first error is another defect");
  assert.equal(await p({ ...err, p: "statement_block" }, "accept", "accept").test("x", "script", cause), false, "another position class");
});

test("reject mode: no tree error, both tools say syntax, with the original's messages and token class (names ignored)", async () => {
  const mk = (e, bc, bm, oc, om, at = 0) => makePredicate("reject", { ts: async () => ({ e }), babel: cls(bc, bm), oxc: clsAt(oc, om, at) });
  assert.equal(normMsg("Unexpected token `foo`"), "Unexpected token _");
  assert.equal(normMsg('Unexpected token, expected "," (1:5)'), "Unexpected token, expected _", "Babel's position and quoted names are dropped");
  const from = mk(false, "syntax", "Missing semicolon. (1:3)", "syntax", "Unexpected token `foo`", 2);
  const want = from.cause("a b", "script");
  assert.equal(want, "Unexpected token _ | Missing semicolon. | id");
  const ok = (e, bc, bm, oc, om, src = "a c") => mk(e, bc, bm, oc, om, 2).test(src, "script", want);
  assert.equal(await ok(false, "syntax", "Missing semicolon. (1:9)", "syntax", "Unexpected token `bar`"), true);
  assert.equal(await ok(false, "syntax", "Missing semicolon.", "syntax", "Missing semicolon"), false, "oxc drifted to another error");
  assert.equal(await ok(false, "syntax", "Unexpected token (1:1)", "syntax", "Unexpected token `bar`"), false, "Babel's message drifted: oxc's message alone is not the defect");
  assert.equal(await ok(false, "syntax", "Missing semicolon.", "syntax", "Unexpected token `bar`", "a )"), false, "the error is at another kind of token");
  assert.equal(await ok(true, "syntax", "Missing semicolon.", "syntax", "Unexpected token `bar`"), false, "the grammar rejects it");
  assert.equal(await ok(false, "accept", "", "syntax", "Unexpected token `bar`"), false);
});

test("the token at an error position is classed, not copied", () => {
  assert.deepEqual([["a b", 2], ["x=1", 2], ["é1", 0], ["a )", 2], ["if", 0], ["a", 5], ["a => b", 2], ["a >= b", 2], ["a > b", 2], ["a ?. b", 2]].map(([s, at]) => tokenAt(s, at)), ["id", "num", "id", ")", "if", "", "=>", ">=", ">", "?."]);
  assert.equal(tokenAt("a b", null), "");
});

test("structure mode: clean tree, both tools accept, a mismatch with the same side/family/kind/parent", async () => {
  const diff = { side: "T", f: "E:call", kind: "call_expression", parent: "expression_statement" };
  const mk = (c, diffs) => makePredicate("structure", { ts: async () => ({ c }), babel: cls("accept"), oxc: cls("accept"), structure: async () => diffs });
  const cause = makePredicate("structure", {}).cause(diff);
  assert.equal(cause, "T:E:call:call_expression:expression_statement");
  assert.equal(await mk(true, [diff]).test("x", "script", cause), true);
  assert.equal(await mk(true, [{ ...diff, kind: "await_expression" }]).test("x", "script", cause), false);
  assert.equal(await mk(true, [{ ...diff, parent: "program" }]).test("x", "script", cause), false, "the same kind under another parent is another defect");
  assert.equal(await mk(true, []).test("x", "script", cause), false);
  assert.equal(await mk(false, [diff]).test("x", "script", cause), false, "an error tree belongs to the other runs");
});

test("ddmin keeps only the chunks the predicate needs", async () => {
  const keep = ["b", "e"];
  const out = await ddmin("abcdefgh".split(""), async (s) => keep.every((k) => s.includes(k)), Infinity, (c) => c.join(""));
  assert.deepEqual(out, keep);
});

test("tokens keep strings with escaped quotes and line breaks apart", () => {
  assert.deepEqual("'a\\'b' x".match(TOKEN), ["'a\\'b'", " ", "x"]);
  assert.deepEqual("'\r\n'".match(TOKEN), ["'", "\r\n", "'"], "a string literal cannot contain a line feed");
});

test("reduce shrinks and simplifies while the predicate holds", async () => {
  const test_ = async (s) => /yield/.test(s) && /\+/.test(s);
  const out = await reduce("function foo(){\n  var longName = 12345;\n  yield + 'text';\n}\n", test_);
  assert.match(out, /^yield\s*\+$/);
});
