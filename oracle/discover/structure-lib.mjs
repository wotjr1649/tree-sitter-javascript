// Range comparison of Babel's AST and this grammar's tree (the logic of structure.mjs; no I/O, so it is unit-tested).
//
// Both sides are reduced to items {f, s, e}: a family f and a byte range [s, e) of the (prefixed) source. A family is a
// coarse class that both trees have (`S:if` is Babel's IfStatement and tree-sitter's if_statement; `E:call` is CallExpression,
// OptionalCallExpression, TaggedTemplateExpression, ImportExpression and call_expression). An item that one side has and the
// other has not, at the same range and family, is a mismatch. The kind mapping stays coarse on purpose: it is a range
// comparison, not an ESTree-to-tree-sitter conversion.
//
// Families: S: statements and declarations, E: expressions, L: leaves (identifiers, literals), P: patterns, M: members.
// Normalisations (each is a known representation difference, not a defect; the report lists their counts):
//   - parentheses: Babel runs with createParenthesizedExpressions, so ParenthesizedExpression matches parenthesized_expression;
//     the parenthesized head of if/while/do/switch/with is a parenthesized_expression in this grammar and nothing in Babel (dropped)
//   - the statement_block of a class_static_block is the StaticBlock itself in Babel (dropped)
//   - a statement or class field range loses one trailing `;` on both sides (the grammar puts the `;` of a for header into its declaration)
//   - for (...;...;...) initializer/condition/increment are expression_statement/empty_statement in this grammar (dropped)
//   - the declaration of `for (var x of y)` is part of the for_in_statement in this grammar (Babel's VariableDeclaration dropped)
//   - `export default function(){}` / `class{}` without a name are a function_expression/class in this grammar (the
//     grammar's design: the value of export_statement is an expression); Babel's declaration is read as that expression
//   - a spread in a JSX element is a spread_element inside jsx_expression (dropped; Babel: JSXSpread*, braces included),
//     and `this` in `<this.Foo/>` is a JSXIdentifier in Babel
//   - the `default` of an import/export specifier is a keyword token in this grammar (Babel: Identifier, dropped); the
//     attributes of `import ... with { ... }` are an object node with pairs here (dropped)
//   - Identifier children of MetaProperty and PrivateName are tokens in this grammar (dropped); a shorthand
//     ObjectProperty is no pair (its key and value are the same identifier)
//   - ObjectPattern/ObjectExpression and ArrayPattern/ArrayExpression share a family, as do the identifier-like kinds
//   - directives are statements (expression_statement of a string), JSX text is not an item
//   - Babel's UTF-16 offsets become UTF-8 byte offsets

export const B_FAMILY = {
  BlockStatement: "S:block", ExpressionStatement: "S:expr", Directive: "S:expr", VariableDeclaration: "S:var",
  FunctionDeclaration: "S:func", ClassDeclaration: "S:class", IfStatement: "S:if", ForStatement: "S:for",
  ForInStatement: "S:forin", ForOfStatement: "S:forin", WhileStatement: "S:while", DoWhileStatement: "S:do",
  ReturnStatement: "S:return", BreakStatement: "S:break", ContinueStatement: "S:continue", ThrowStatement: "S:throw",
  TryStatement: "S:try", SwitchStatement: "S:switch", LabeledStatement: "S:label", WithStatement: "S:with",
  DebuggerStatement: "S:debugger", EmptyStatement: "S:empty", ImportDeclaration: "S:import",
  ExportNamedDeclaration: "S:export", ExportDefaultDeclaration: "S:export", ExportAllDeclaration: "S:export",
  CallExpression: "E:call", OptionalCallExpression: "E:call", TaggedTemplateExpression: "E:call", ImportExpression: "E:call",
  NewExpression: "E:new", MemberExpression: "E:member", OptionalMemberExpression: "E:member", JSXMemberExpression: "E:member",
  AssignmentExpression: "E:assign", BinaryExpression: "E:binary", LogicalExpression: "E:binary", UnaryExpression: "E:unary",
  UpdateExpression: "E:update", ConditionalExpression: "E:cond", SequenceExpression: "E:seq", YieldExpression: "E:yield",
  AwaitExpression: "E:await", ArrowFunctionExpression: "E:arrow", FunctionExpression: "E:fexpr", ClassExpression: "E:class",
  ObjectExpression: "E:obj", ObjectPattern: "E:obj", ArrayExpression: "E:arr", ArrayPattern: "E:arr", TemplateLiteral: "E:tpl",
  ParenthesizedExpression: "E:paren", MetaProperty: "E:meta", JSXElement: "E:jsx", JSXFragment: "E:jsx",
  Identifier: "L:id", JSXIdentifier: "L:id", PrivateName: "L:id", ThisExpression: "L:this", Super: "L:super", NullLiteral: "L:null",
  BooleanLiteral: "L:bool", NumericLiteral: "L:num", BigIntLiteral: "L:num", StringLiteral: "L:str", DirectiveLiteral: "L:str",
  RegExpLiteral: "L:regex",
  AssignmentPattern: "P:default", RestElement: "P:rest", SpreadElement: "P:rest",
  ObjectMethod: "M:method", ClassMethod: "M:method", ClassPrivateMethod: "M:method",
  ClassProperty: "M:field", ClassPrivateProperty: "M:field", ClassAccessorProperty: "M:field", StaticBlock: "M:static",
  ClassBody: "M:body", ObjectProperty: "M:pair", CatchClause: "M:catch", SwitchCase: "M:case", VariableDeclarator: "M:declarator",
  JSXAttribute: "M:jsxattr",
};

export const T_FAMILY = {
  statement_block: "S:block", expression_statement: "S:expr", variable_declaration: "S:var", lexical_declaration: "S:var",
  using_declaration: "S:var", function_declaration: "S:func", generator_function_declaration: "S:func", class_declaration: "S:class",
  if_statement: "S:if", for_statement: "S:for", for_in_statement: "S:forin", while_statement: "S:while", do_statement: "S:do",
  return_statement: "S:return", break_statement: "S:break", continue_statement: "S:continue", throw_statement: "S:throw",
  try_statement: "S:try", switch_statement: "S:switch", labeled_statement: "S:label", with_statement: "S:with",
  debugger_statement: "S:debugger", empty_statement: "S:empty", import_statement: "S:import", export_statement: "S:export",
  call_expression: "E:call", new_expression: "E:new", member_expression: "E:member", subscript_expression: "E:member",
  assignment_expression: "E:assign", augmented_assignment_expression: "E:assign", binary_expression: "E:binary",
  unary_expression: "E:unary", update_expression: "E:update", ternary_expression: "E:cond", sequence_expression: "E:seq",
  yield_expression: "E:yield", await_expression: "E:await", arrow_function: "E:arrow", function_expression: "E:fexpr",
  generator_function: "E:fexpr", class: "E:class", object: "E:obj", object_pattern: "E:obj", array: "E:arr", array_pattern: "E:arr",
  template_string: "E:tpl", parenthesized_expression: "E:paren", meta_property: "E:meta", jsx_element: "E:jsx",
  jsx_self_closing_element: "E:jsx",
  identifier: "L:id", property_identifier: "L:id", shorthand_property_identifier: "L:id", shorthand_property_identifier_pattern: "L:id",
  statement_identifier: "L:id", private_property_identifier: "L:id", undefined: "L:id", this: "L:this", super: "L:super", null: "L:null",
  true: "L:bool", false: "L:bool", number: "L:num", string: "L:str", regex: "L:regex",
  assignment_pattern: "P:default", object_assignment_pattern: "P:default", rest_pattern: "P:rest", spread_element: "P:rest",
  method_definition: "M:method", field_definition: "M:field", class_static_block: "M:static", class_body: "M:body",
  pair: "M:pair", pair_pattern: "M:pair", catch_clause: "M:catch", switch_case: "M:case", switch_default: "M:case",
  variable_declarator: "M:declarator", jsx_attribute: "M:jsxattr",
};

// kinds the grammar has in the statement/declaration/expression/pattern supertypes that no family covers on purpose
export const T_UNCOVERED_OK = new Set([]);
// extra kinds the dump needs for context (owners of statement lists, parents that drive normalisations)
export const T_CONTEXT = ["program", "switch_body", "comment", "html_comment"];
const COMMENT = new Set(["comment", "html_comment"]);

// ---- tree-sitter side ----------------------------------------------------------------------------------------------

// Kinds of node-types.json that belong to the four supertypes, supertypes expanded; the ones without a family.
export function uncoveredKinds(nodeTypes) {
  const by = new Map(nodeTypes.filter((t) => t.subtypes).map((t) => [t.type, t.subtypes.map((s) => s.type)]));
  const seen = new Set();
  const walk = (k) => {
    if (by.has(k)) by.get(k).forEach(walk);
    else seen.add(k);
  };
  ["statement", "declaration", "expression", "pattern"].forEach(walk);
  return [...seen].filter((k) => !(k in T_FAMILY) && !T_UNCOVERED_OK.has(k)).sort();
}

// ids of the kinds tsparse should dump, from its {"kinds":..} table (alias kinds have several ids)
export function wantedIds(kinds) {
  const names = new Set([...Object.keys(T_FAMILY), ...T_CONTEXT]);
  return kinds.flatMap((k, i) => (names.has(k) ? [i] : []));
}

const HEAD_PARENT = new Set(["if_statement", "while_statement", "do_statement", "switch_statement", "with_statement"]);

// dump: tsparse's flat quintuples (kind id, start, end, parent index, field id); kinds/fields: its id tables.
// Returns {items: [[f, s, e, kind, parentKind]...], lists: Map(ownerKey -> statement count)}. An owner of a statement list
// (program, block, static block, switch case) gets its entry, with 0, the moment it is met; its key is built from the same
// (trimmed) range as its item, as on Babel's side (ownerKey), so that an empty or odd owner is compared as well.
export function tsItems(dump, kinds, fields, buf, norm = {}) {
  const bump = (k) => (norm[k] = (norm[k] ?? 0) + 1);
  const items = [];
  const lists = new Map();
  const owner = new Map(); // dump index -> list key
  const n = dump.length / 5;
  const cm = new Map(); // comment end -> start
  for (let i = 0; i < n; i++) if (COMMENT.has(kinds[dump[i * 5]])) cm.set(dump[i * 5 + 2], dump[i * 5 + 1]);
  for (let i = 0; i < n; i++) {
    const kind = kinds[dump[i * 5]];
    const p = dump[i * 5 + 3];
    const pk = p >= 0 ? kinds[dump[p * 5]] : "";
    const field = fields[dump[i * 5 + 4]] ?? "";
    let f = T_FAMILY[kind];
    if (kind === "program") { owner.set(i, "program"); lists.set("program", 0); }
    if (!f) continue;
    if ((kind === "expression_statement" || kind === "empty_statement") && pk === "for_statement" && field !== "body") { bump("forHeaderStatement"); continue; }
    if (kind === "statement_block" && pk === "class_static_block") { // Babel's StaticBlock has no block inside: its statements are the static block's
      bump("staticBlockBlock");
      const key = ownerKey("static_block", dump[p * 5 + 1], dump[p * 5 + 2]);
      owner.set(i, key);
      lists.set(key, 0);
      continue;
    }
    if (kind === "spread_element" && pk.startsWith("jsx_")) { bump("jsxSpread"); continue; } // Babel: JSXSpreadAttribute/JSXSpreadChild, braces included
    if (kind === "parenthesized_expression" && HEAD_PARENT.has(pk) && p >= 0) { bump("headParen"); continue; }
    if (kind === "object" && pk === "import_statement") { bump("importAttributes"); continue; } // `with { type: "json" }` is an object here
    if (kind === "pair" && pk === "object" && kinds[dump[dump[p * 5 + 3] * 5]] === "import_statement") { bump("importAttributes"); continue; }
    let s = dump[i * 5 + 1];
    let e = dump[i * 5 + 2];
    if (STRIP(f)) e = trimEnd(buf, s, e, cm);
    items.push([f, s, e, kind, pk]);
    if (f === "S:block" || f === "M:case") {
      const key = ownerKey(f === "S:block" ? "statement_block" : "switch_case", s, e);
      owner.set(i, key);
      lists.set(key, 0);
    }
    if (f.startsWith("S:") && owner.has(p)) lists.set(owner.get(p), lists.get(owner.get(p)) + 1);
  }
  return { items, lists };
}

// The key of a statement-list owner on either side: its kind name and its (trimmed) byte range; the program has no range.
const ownerKey = (name, s, e) => `${name}:${s}:${e}`;

const STRIP = (f) => (f.startsWith("S:") && f !== "S:empty") || f === "M:field" || f === "M:case";
// The end of a statement or field: without trailing white space and comments (this grammar keeps a trailing comment
// inside the statement it ends, Babel does not) and without one terminating `;`. cm maps a comment end to its start.
function trimEnd(buf, s, e, cm) {
  const ws = () => {
    while (e > s) {
      const c = buf[e - 1];
      if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) e--;
      else if (e - s >= 2 && c === 0xa0 && buf[e - 2] === 0xc2) e -= 2; // NBSP
      else if (e - s >= 3 && ((buf[e - 3] === 0xe2 && buf[e - 2] === 0x80 && (c === 0xa8 || c === 0xa9)) || (buf[e - 3] === 0xef && buf[e - 2] === 0xbb && c === 0xbf))) e -= 3; // LS PS BOM
      else return;
    }
  };
  const comments = () => {
    for (;;) {
      ws();
      const c = cm.get(e);
      if (c === undefined || c <= s) return;
      e = c;
    }
  };
  comments();
  if (e > s && buf[e - 1] === 0x3b) {
    e--;
    comments();
  }
  return e;
}

// ---- Babel side ----------------------------------------------------------------------------------------------------

const SKIP = new Set(["type", "start", "end", "loc", "range", "extra", "leadingComments", "trailingComments", "innerComments", "comments", "tokens", "errors"]);

// Offsets: Babel's UTF-16 indexes to UTF-8 bytes of `src` (identity for ASCII-only sources).
export function byteMap(src) {
  if (Buffer.byteLength(src, "utf8") === src.length) return null;
  const m = new Uint32Array(src.length + 1);
  let b = 0;
  for (let i = 0; i < src.length; i++) {
    m[i] = b;
    const c = src.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < src.length) { b += 4; m[++i] = b; } // a surrogate pair is one 4-byte character
    else b += 3;
  }
  m[src.length] = b;
  return m;
}

// Items of a Babel AST (File node, built with createParenthesizedExpressions). `buf` is the UTF-8 source.
export function babelItems(file, src, buf, norm = {}) {
  const bump = (k) => (norm[k] = (norm[k] ?? 0) + 1);
  const map = byteMap(src);
  const at = (i) => (map ? map[i] : i);
  const cm = new Map(); // comment end -> start
  for (const c of file.comments ?? []) cm.set(at(c.end), at(c.start));
  const items = [];
  const lists = new Map();
  const stack = [[file.program, null, ""]];
  while (stack.length) {
    const [node, parent, key] = stack.pop();
    const type = node.type;
    let f = B_FAMILY[type];
    if (type === "Program") lists.set("program", node.body.length + (node.directives?.length ?? 0));
    if (type === "StaticBlock") lists.set(ownerKey("static_block", at(node.start), at(node.end)), node.body.length);
    if (f) {
      const pt = parent?.type ?? "";
      let drop = false;
      if (type === "VariableDeclaration" && (pt === "ForInStatement" || pt === "ForOfStatement") && key === "left") { drop = node.forLeft = true; bump("forInDeclaration"); } // its declarators go too
      else if (type === "VariableDeclarator" && parent.forLeft) drop = true;
      else if ((type === "FunctionDeclaration" || type === "ClassDeclaration") && pt === "ExportDefaultDeclaration" && !node.id) { bump("exportDefaultAnonymous"); f = type === "ClassDeclaration" ? "E:class" : "E:fexpr"; }
      else if (type === "Identifier" && (pt === "MetaProperty" || pt === "PrivateName")) { drop = true; bump("tokenIdentifier"); }
      else if (type === "Identifier" && node.name === "default" && /^(Export|Import)(Namespace)?Specifier$/.test(pt)) { drop = true; bump("defaultSpecifier"); }
      else if (type === "JSXIdentifier" && node.name === "this" && pt === "JSXMemberExpression" && key === "object") f = "L:this";
      else if (type === "ObjectProperty" && node.shorthand) { drop = true; bump("shorthandPair"); }
      if (!drop) {
        const s = at(node.start);
        let e = at(node.end);
        if (STRIP(f)) e = trimEnd(buf, s, e, cm);
        items.push([f, s, e, type, pt]);
      }
      if (f === "S:block" || type === "SwitchCase") { // the key is the item's range (the one just pushed), as on the grammar's side
        const [, s, e] = items[items.length - 1];
        const list = type === "SwitchCase" ? node.consequent : node.body;
        lists.set(ownerKey(type === "SwitchCase" ? "switch_case" : "statement_block", s, e), list.length + (node.directives?.length ?? 0));
      }
    }
    for (const k of Object.keys(node)) {
      if (SKIP.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) if (v[i] && typeof v[i].type === "string") stack.push([v[i], node, k]);
      } else if (v && typeof v === "object" && typeof v.type === "string") stack.push([v, node, k]);
    }
  }
  return { items, lists };
}

// ---- comparison ----------------------------------------------------------------------------------------------------

const key = (s, e) => s * 16777216 * 16 + e; // offsets stay below 2^28 (inputs are at most 16 MiB)

// Mismatches between two item lists: [{side: "B"|"T", f, s, e, kind, parent}] sorted by start, widest first.
// side B: Babel has the item and this grammar has none of the family at that range; side T: the other way round.
export function diffItems(b, t) {
  const index = (items) => {
    const m = new Map();
    for (const [f, s, e] of items) {
      let set = m.get(f);
      if (!set) m.set(f, (set = new Set()));
      set.add(key(s, e));
    }
    return m;
  };
  const bi = index(b);
  const ti = index(t);
  const out = [];
  const once = new Set();
  for (const [f, s, e, kind, parent] of b) {
    if (ti.get(f)?.has(key(s, e)) || once.has(`B${f}${s}:${e}`)) continue;
    once.add(`B${f}${s}:${e}`);
    out.push({ side: "B", f, s, e, kind, parent });
  }
  for (const [f, s, e, kind, parent] of t) {
    if (bi.get(f)?.has(key(s, e)) || once.has(`T${f}${s}:${e}`)) continue;
    once.add(`T${f}${s}:${e}`);
    out.push({ side: "T", f, s, e, kind, parent });
  }
  return out.sort((x, y) => x.s - y.s || y.e - x.e || (x.side < y.side ? -1 : 1));
}

// Owners (program, blocks, static blocks, switch cases) present on both sides with different statement counts.
export function diffLists(bl, tl) {
  const out = [];
  for (const [k, n] of bl) if (tl.has(k) && tl.get(k) !== n) out.push({ owner: k, babel: n, ts: tl.get(k) });
  return out;
}

// One comparison: the whole result for one input.
export function compare(file, src, dump, kinds, fields) {
  const buf = Buffer.from(src, "utf8");
  const norm = {};
  const b = babelItems(file, src, buf, norm);
  const t = tsItems(dump, kinds, fields, buf, norm);
  return { diffs: diffItems(b.items, t.items), lists: diffLists(b.lists, t.lists), nb: b.items.length, nt: t.items.length, norm };
}
