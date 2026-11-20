import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { byteMap, compare, diffItems, uncoveredKinds, wantedIds } from "../structure-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { parse } = createRequire(join(here, "../../run.mjs"))("@babel/parser");
const KINDS = ["end", "program", "expression_statement", "call_expression", "arrow_function", "identifier", "for_statement", "empty_statement",
  "if_statement", "parenthesized_expression", "comment", "statement_block", "number", "yield_expression",
  "switch_case", "class_declaration", "class_body", "class_static_block", "export_statement", "import_attribute", "object", "pair", "property_identifier", "string"];
const FIELDS = ["", "body", "condition", "initializer"];
// a fake tsparse dump: rows of [kind name, start, end, parent index, field name]
const dump = (rows) => rows.flatMap(([k, s, e, p, f]) => [KINDS.indexOf(k), s, e, p, FIELDS.indexOf(f ?? "")]);
const run = (src, rows, type = "script") =>
  compare(parse(src, { sourceType: type, plugins: ["jsx"], createParenthesizedExpressions: true }), src, dump(rows), KINDS, FIELDS);

test("a tree that agrees with Babel has no mismatch", () => {
  const r = run("a;", [["program", 0, 2, -1], ["expression_statement", 0, 2, 0], ["identifier", 0, 1, 1]]);
  assert.deepEqual([r.diffs, r.lists], [[], []]);
});

test("#354: `()=>{}` newline `(1)` read as one call is a statement mismatch and a list count mismatch", () => {
  const src = "()=>{}\n(1)";
  const r = run(src, [["program", 0, 10, -1], ["expression_statement", 0, 10, 0], ["call_expression", 0, 10, 1], ["arrow_function", 0, 6, 2], ["statement_block", 4, 6, 3]]);
  const stmts = r.diffs.filter((d) => d.f === "S:expr").map((d) => `${d.side}${d.s}-${d.e}`);
  assert.deepEqual(stmts.sort(), ["B0-6", "B7-10", "T0-10"]);
  assert.deepEqual(r.lists, [{ owner: "program", babel: 2, ts: 1 }]);
});

test("a trailing comment inside a statement and the terminating semicolon are not mismatches", () => {
  const src = "a // c";
  const r = run(src, [["program", 0, 6, -1], ["expression_statement", 0, 6, 0], ["identifier", 0, 1, 1], ["comment", 2, 6, 1]]);
  assert.deepEqual(r.diffs, []);
  const r2 = run("a /*c*/ ;", [["program", 0, 9, -1], ["expression_statement", 0, 9, 0], ["identifier", 0, 1, 1], ["comment", 2, 7, 1]]);
  assert.deepEqual(r2.diffs, []);
});

test("for-header statements and the parenthesized head of if are normalised away, the body is not", () => {
  const src = "for(;;) a;\nif (b) c;";
  const rows = [
    ["program", 0, 20, -1],
    ["for_statement", 0, 10, 0], ["empty_statement", 4, 5, 1, "initializer"], ["empty_statement", 5, 6, 1, "condition"], ["expression_statement", 8, 10, 1, "body"], ["identifier", 8, 9, 4],
    ["if_statement", 11, 20, 0], ["parenthesized_expression", 14, 17, 6, "condition"], ["identifier", 15, 16, 7], ["expression_statement", 18, 20, 6], ["identifier", 18, 19, 9],
  ];
  const r = run(src, rows);
  assert.deepEqual(r.diffs, []);
  assert.deepEqual(r.norm, { forHeaderStatement: 2, headParen: 1 });
});

test("static export attributes are normalised without dropping exported objects", () => {
  const src = 'export * from "m" with {type:"json"}; export default {type:"json"};';
  const rows = [
    ["program", 0, 67, -1],
    ["export_statement", 0, 37, 0], ["string", 14, 17, 1],
    ["import_attribute", 18, 36, 1], ["object", 23, 36, 3], ["pair", 24, 35, 4],
    ["property_identifier", 24, 28, 5], ["string", 29, 35, 5],
    ["export_statement", 38, 67, 0], ["object", 53, 66, 8], ["pair", 54, 65, 9],
    ["property_identifier", 54, 58, 10], ["string", 59, 65, 10],
  ];
  const r = run(src, rows, "module");
  assert.deepEqual(r.diffs, []);
  assert.deepEqual(r.norm, { importAttributes: 2 });
});

test("#259 and `yield` as an identifier are reported on both sides", () => {
  const src = "yield + 1";
  const r = run(src, [["program", 0, 9, -1], ["expression_statement", 0, 9, 0], ["yield_expression", 0, 9, 1]]);
  assert.deepEqual(r.diffs.map((d) => `${d.side}:${d.f}`), ["B:E:binary", "T:E:yield", "B:L:id", "B:L:num"]);
});

test("a range with the same family at the same offsets is one item however often it occurs", () => {
  const b = [["L:id", 0, 1, "Identifier", "X"], ["L:id", 0, 1, "Identifier", "Y"]];
  assert.deepEqual(diffItems(b, [["L:id", 0, 1, "identifier", ""]]), []);
  assert.equal(diffItems(b, []).length, 1);
});

test("offsets are UTF-8 bytes: BMP, astral and ASCII characters", () => {
  assert.equal(byteMap("abc"), null, "ASCII needs no map");
  const m = byteMap("é😀x");
  assert.deepEqual([m[0], m[1], m[3], m[4]], [0, 2, 6, 7]); // é = 2 bytes, 😀 = 2 UTF-16 units = 4 bytes, x at 6, end 7
});

test("every kind of the statement, declaration, expression and pattern supertypes has a family", () => {
  const nodeTypes = JSON.parse(readFileSync(join(here, "../../../src/node-types.json"), "utf8"));
  assert.deepEqual(uncoveredKinds(nodeTypes), []);
});

test("wantedIds lists every id of a wanted kind name (alias kinds have several)", () => {
  assert.deepEqual(wantedIds(["end", "identifier", "x", "identifier", "program"]), [1, 3, 4]);
});

test("a block with a statement on Babel's side and none in the dump is a list mismatch (the owner counts from 0)", () => {
  const r = run("{;}", [["program", 0, 3, -1], ["statement_block", 0, 3, 0]]);
  assert.deepEqual(r.lists, [{ owner: "statement_block:0:3", babel: 1, ts: 0 }]);
});

test("a switch case and a static block are list owners on both sides, with the same range basis", () => {
  const src = "switch(a){case 1: b; // c\n}";
  const at = src.indexOf("case");
  const cm = src.indexOf("//");
  const c = run(src, [["program", 0, src.length, -1], ["switch_case", at, src.length - 2, 0], ["comment", cm, src.length - 2, 1]]); // the grammar's case keeps the trailing comment
  assert.deepEqual(c.lists.filter((l) => l.owner !== "program"), [{ owner: `switch_case:${at}:${src.indexOf("b;") + 1}`, babel: 1, ts: 0 }]);
  const s2 = "class A{static{a;}}";
  const st = s2.indexOf("static");
  const r = run(s2, [["program", 0, 19, -1], ["class_declaration", 0, 19, 0], ["class_body", 7, 19, 1], ["class_static_block", st, 18, 2], ["statement_block", st + 6, 18, 3]]);
  assert.deepEqual(r.lists, [{ owner: `static_block:${st}:18`, babel: 1, ts: 0 }]);
});
