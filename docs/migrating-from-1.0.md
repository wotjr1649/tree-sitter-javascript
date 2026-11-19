# Moving from 1.0.0 to 2.0.0

2.0.0 is the first release of this repository after the baseline. 1.0.0 behaves like the origin,
[`tree-sitter/tree-sitter-javascript`](https://github.com/tree-sitter/tree-sitter-javascript) v0.25.0 (commit
`44c892e`): `src/` is byte-identical to what tree-sitter CLI 0.27.2 generates from it. If you come from 0.25.0 you
meet the same changes. Measured against 1.0.0, `src/node-types.json` changes as follows:

| | count |
| --- | ---: |
| node kinds removed | 0 |
| node kinds added | 0 |
| node/field pairs removed | 0 |
| types a field accepts, removed | 0 |
| types a field accepts, added | 1 (`using_declaration` in `for_statement.initializer`) |

The grammar name `javascript`, the C symbol `tree_sitter_javascript`, ABI 15 and the binding lower bounds are unchanged.

## Trees that change for input 1.0.0 parsed without an error

This is why the version is 2.0.0. 18 of the 533 distinct inputs that 1.0.0 parsed without an error (3.4 %) get a
different tree: 16 are valid code (Babel 8.1.2 and oxc 0.159.0 accept them; `await using` + line break + `x = 1;` at
top level only as a module) and still parse without an error, which is a breaking change; 2 are invalid code (both
reject them) and now give an error. 373 inputs that gave an error in 1.0.0 no longer do (next section).
A query or walker written against the old tree of these forms stops matching. All of them involve `using`:

| form | 1.0.0 | 2.0.0 | why |
| --- | --- | --- | --- |
| `using [a] = b;` (also `{ using [a] = b; }`, `using` + line break + `[a] = b`) | `using_declaration` with a `variable_declarator` whose `name` is an `array_pattern` | `expression_statement` of an `assignment_expression` whose `left` is a `subscript_expression` | a using declaration binds identifiers only, so `using [` starts an expression (J4) |
| `using` + line break + `x = 1;` (also in a block) | one `using_declaration` | two `expression_statement`s: `using` as an `identifier`, then `x = 1` | no line terminator is allowed after `using`; the scanner's automatic semicolon applies (J4) |
| `async function f() { await using` + line break + `x = 1; }` (also at module top level) | `using_declaration` | an `await_expression` of `using` (an `identifier`), then the assignment as its own statement | same rule (J4) |
| `for (using` + line break + `x of y);` | `for_in_statement` with `kind: using`, `left: x` | an error (`ERROR` node) | no line terminator after `using` (J5) |
| `for (using` + line break + `of of y);` | `for_in_statement` with `kind: using`, `left: of` | an error | same (J5) |

In the comparisons recorded for each fix (corpus, `examples/`, highlight and tags inputs, `typescript.js`, Korean
samples, and 2,000 to 2,600 probe inputs for the later fixes) no other input that parsed cleanly was reported to change
its tree, and none was reported to get an error except the `for (using` + line break + `of` forms above. Those
comparisons are against each fix's own base; the count above compares `v1.0.0` with the release directly (see below).

Forms that keep their trees: block and `await using` declarations, `using x = a, y = b;`, `for (using x of y)`,
`for await (using x of y)`, `for (await using x of y)`, `using` on the same line as its name, a type annotation
(`using x: Disposable = f();` in TypeScript) and a same-line comment after `using`.

### Where the count comes from

The 1.0.0 parser (`v1.0.0`, `d6501de`) and the fixes at `d4d699d` parsed (#24, merged after it, keeps every tree,
field, range and query capture on 2,040 inputs in JS, TS and TSX; under `src/` the release commit differs from `78abf56` only
in `parser.c` `.metadata`), through the tree-sitter API, 1,068 distinct inputs (deduplicated by UTF-8 bytes): the
corpus, highlight and tags inputs, `examples/*.js`, the 158 `oracle/cases.jsonl` sources, the seven go-treesitter
Korean samples and the J1-J5/J3b probe inputs, without TypeScript-only inputs. S-expressions with fields and byte ranges
were compared (numeric symbol ids excluded). Of the 1,068 inputs, 533 parsed without an error in 1.0.0: 515 keep their
tree, 16 change and stay error-free (J4), 2 change to an error (J5). Of the 535 that gave an error, 373 parse without
one now. `typescript.js` (TypeScript 6.0.3, 9,144,216 bytes) gives the same tree in both.

## Input that gave a parse error in 1.0.0 and parses now

These gave an `ERROR` or `MISSING` node in 1.0.0 and parse without one. All rows but the last are valid code; they are
fixes, listed so you know which inputs no longer fail. Trees follow the kinds other names already use.

| input | 1.0.0 | 2.0.0 |
| --- | --- | --- |
| `<p>a & b</p>`, `<p>&</p>`, `<p>&한글</p>` (J1) | `ERROR` | `jsx_text` (a `&` that does not start a character reference); `&amp;`, `&#38;`, `&#x26;` stay `html_character_reference` |
| `<p>&#１;</p>`, `<p>&#xＦ;</p>` on Windows (J1b) | `ERROR` | `jsx_text` |
| `a?.delete(b)`, `a?.class` in the TS/TSX grammar built on this one (J2) | `ERROR` | `property_identifier` (standalone JavaScript already parsed them) |
| `<class />`, `<Foo.class />`, `<a.delete />`, `<C in={x} />` (J3) | `ERROR` | element name `identifier`, member `property_identifier`, attribute name `property_identifier` |
| `<this.props.Foo />`, `<this.Foo />` (J3b) | `ERROR` | `member_expression` (`object: this`, `property: property_identifier`) |
| `using = 1`, `using(x)`, `using.x`, `using++`, `for (using of x)`, `for (using` + line break + `of y);` (J4) | `ERROR` | `using` as `identifier`, like any other name |
| `for (using x = f();;) {}`, `for (await using x = f();;) {}` in an async function (J5) | `ERROR` | `for_statement` with `initializer: (using_declaration ...)` |
| `<class></for>` (element pair with reserved-word names; J3) | `ERROR` | two element names, not compared |

The last row is not valid JSX: Babel, oxc and TypeScript report the mismatched tags. 2.0.0 reads it without an
`ERROR` node, as it reads `<a></b>` (tag names were never compared, #20); tools that relied on the tree-sitter error
for it no longer see one.

## Recovery trees of invalid input

Trees of inputs that give an error before and after may differ anywhere, `ERROR` and `MISSING` nodes included (a minor
change). Recorded
examples: `a..class` (`MISSING property_identifier` at `[2,2)` in 1.0.0, `ERROR[2,3)` now), `a?. .class`, `a.?.class`,
`a.[class]` (J2); `<class />>` (`ERROR(regex_pattern)` becomes `ERROR(jsx_self_closing_element ...)`), `<a class= />`
(J3); `<this. />` and `<this.#a />` in JS and TSX (J3b); error ranges of invalid `using` forms such as standalone-JavaScript
`using file: Disposable = f();` (J4, J5). Inputs that are still errors stay errors.

## `GrammarName()` and numeric symbol ids

Public kinds and fields are unchanged, but the underlying grammar symbols are not:

- In standalone JavaScript a keyword after `.` or `?.` is lexed as the keyword token and aliased to
  `property_identifier` (J2). `Kind()`, `KindId()` of the aliased node, its fields and node-types are the same, but
  `GrammarName()`/`GrammarId()` change: `a.class` was `identifier`/1 and is `class`/54 (ids at the time of J2).
- J3 and J3b shift the numeric symbol table: the J3 measurement showed `KindId()` streams differing in 104 of 118
  corpus inputs with names and ranges equal, and J3b moved `member_expression` from 211 to 212,
  `jsx_self_closing_element` from 197 to 198 and `property_identifier` from 264 to 265 (JS; TSX 251/234/397 to
  252/235/398). In the TS/TSX grammar built on this one, numeric symbols shift too.
- Query files load unchanged, because no kind or field is removed, but their captures follow the tree: where a tree
  changes (the `using` rows above), captures change with it. `queries/highlights.scm` on `using [a] = b;` now also
  captures `using` as `@variable` `[0,5)`, and `(using_declaration) @d` matches that input once in 1.0.0 and not in
  2.0.0. Captures also change where input that gave an `ERROR` now parses: in `a = <class />;` 2.0.0 captures
  `class` as `@variable`. A consumer that stores or compares numeric symbol ids
  (`KindId()`, `ts_node_symbol`) or the grammar name (`ts_node_grammar_symbol`, `GrammarName()`) must recompute them
  against the 2.0.0 parser.

## For tree-sitter-typescript users

tree-sitter-typescript vendors this `grammar.js`. Two patches there complete J4 and J3b; they were handed over with
this release (`ts-using-keyword-declarator.patch`, `ts-jsx-this-member.patch`):

- J4: `using as: D = f();` and the other type-annotated forms whose first binding is named `as` or `satisfies` need the
  override of the new hidden rule `_using_keyword_declarator` with a type annotation (a few lines). Without it the
  type-annotated form is an error; the unannotated forms already parse.
- J3b: `<this.props.Foo />` parses in standalone JavaScript from this repository alone. TSX defines its own opening
  and self-closing tags, so it needs one line: `alias($._jsx_this_member_expression, $.member_expression)` next to the
  `nested_identifier` choice of `_jsx_start_opening_element`. The TypeScript (non-TSX) parser is byte-identical either
  way.
- `nested_identifier` is shared with TypeScript, so J3 makes `namespace a.class {}` and `let x: a.class.T;` parse
  (TypeScript 6.0.3 accepts both). `import x = a.class;`, `export import x = a.class;` and `import x = a.class.b;`
  parse too although TypeScript rejects them (TS1359). The fix needs a restricted rule in tree-sitter-typescript.
- Regenerate with CLI 0.27.2 (`generate --abi 15 --js-runtime native`). With the TS patches above and this release,
  the TS and TSX corpus gives 111/112; the one failure, `Decorator with parenthesized expression`, is #357's and
  predates this release.

## For go-treesitter

- ADR-0023 patch record 0001 (the JSX bare-ampersand fix) is carried here: `src/scanner.c` has origin PR #388's
  scanner hunks (J1). On top of it J1b adds ASCII-only digit checks, so the scanner no longer equals that record's
  result; go-treesitter retires its patch only in its own, separately approved pin move to this release (its
  ADR-0024 7.5 comparison against the old pin and 7.6).
- Pin comparison inputs: the node-types change above; trees that change for 1.0.0-clean input; symbol ids and
  `GrammarName()`; `src/parser.c` regenerated with CLI 0.27.2.
- go-treesitter's default `dump_tree` records `ts_node_type`, fields and ranges: expect differences only for the
  changed trees above. `tsg-query` output and some field diagnostics record `ts_node_symbol`: expect numeric
  differences there as well.

## What else changes for a consumer

- **No new node kind or field.** Existing query files (`queries/*.scm`) load unchanged; their captures change only
  where the tree changes (see above).
- **Oracle.** The `oracle/` directory (Babel 8.1.2 and oxc 0.159.0 consensus) and its CI replay are new; they do not
  affect the parser.
- **Generated size.** `src/parser.c` is 3,135,009 bytes at `v2.0.0` with 2,048 parse states and 266 symbols, against
  2,855,926 bytes, 1,870 states and 261 symbols at `v1.0.0` (+9.8 %). Before #24 the J3b head (stack of #9 to #15)
  was 3,280,157 bytes with 2,098 states.
- **Speed and memory.** On one shared machine, in paired rounds of the same run, 2.0.0 parsed `typescript.js` 1.46 %
  slower than 1.0.0 (ranges overlap) with the same peak memory (see the CHANGELOG).
- **Known limitations** are tracked as GitHub Issues; see the end of [CHANGELOG.md](../CHANGELOG.md).
