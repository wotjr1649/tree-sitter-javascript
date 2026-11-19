import test from "node:test";
import assert from "node:assert/strict";
import { makePredicate, normMsg } from "../predicate.mjs";
import { ddmin, reduce, TOKEN } from "../reduce.mjs";

const cls = (c, m) => () => ({ c, m });

test("accept mode: tree not clean and both tools accept", async () => {
  const p = (ts, b, o) => makePredicate("accept", { ts: async () => ts, babel: cls(b), oxc: cls(o) });
  assert.equal(await p({ c: false }, "accept", "accept").test("x", "script"), true);
  assert.equal(await p({ c: true }, "accept", "accept").test("x", "script"), false, "a clean tree is not a defect");
  assert.equal(await p({ c: false }, "accept", "early").test("x", "script"), false, "a reproducer must stay valid");
});

test("reject mode: no tree error, both tools say syntax, oxc's message unchanged (names ignored)", async () => {
  const mk = (e, bc, oc, m) => makePredicate("reject", { ts: async () => ({ e }), babel: cls(bc), oxc: cls(oc, m) });
  const cause = normMsg("Unexpected token `foo`");
  assert.equal(cause, "Unexpected token _");
  assert.equal(await mk(false, "syntax", "syntax", "Unexpected token `bar`").test("x", "script", cause), true);
  assert.equal(await mk(false, "syntax", "syntax", "Missing semicolon").test("x", "script", cause), false, "drifted to another error");
  assert.equal(await mk(true, "syntax", "syntax", "Unexpected token `bar`").test("x", "script", cause), false, "the grammar rejects it");
  assert.equal(await mk(false, "accept", "syntax", "Unexpected token `bar`").test("x", "script", cause), false);
});

test("structure mode: clean tree, both tools accept, a mismatch with the same side/family/kind", async () => {
  const diff = { side: "T", f: "E:call", kind: "call_expression" };
  const mk = (c, diffs) => makePredicate("structure", { ts: async () => ({ c }), babel: cls("accept"), oxc: cls("accept"), structure: async () => diffs });
  const cause = makePredicate("structure", {}).cause(diff);
  assert.equal(cause, "T:E:call:call_expression");
  assert.equal(await mk(true, [diff]).test("x", "script", cause), true);
  assert.equal(await mk(true, [{ ...diff, kind: "await_expression" }]).test("x", "script", cause), false);
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
