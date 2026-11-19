# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-11-19

The first release of this independent repository after the `v1.0.0` baseline (origin `tree-sitter/tree-sitter-javascript`
v0.25.0 behaviour, `src/` byte-identical to it). Every fix below makes inputs that `@babel/parser` 8.1.2 and
`oxc-parser` 0.159.0 both accept parse without `ERROR` or `MISSING` nodes, in standalone JavaScript and, where it
applies, in the TypeScript/TSX grammars built on this `grammar.js` (tree-sitter-typescript `59fc4ed` + #357). In
TS/TSX the scanner fixes (J1, J1b) need the same change in tree-sitter-typescript's own scanner, and J3b and J4's
type-annotated form need the patches handed over to it.
Breaking: 18 of the 533 distinct inputs that 1.0.0 parsed without an error get a different tree. 16 still parse without
an error, mostly where 1.0.0 read them wrongly (`using [a] = b`, `using` followed by a line break and a name); 2 that
1.0.0 accepted are now errors (`for (using` + line break + `x of y)` and `... of of y)`). No node kind or field is removed or renamed, the grammar name and
the C symbol are unchanged, and `src/node-types.json` gains one entry (`using_declaration` in
`for_statement.initializer`). The numeric symbol ids and the underlying grammar names (`GrammarName()`) of some nodes
also change. See [docs/migrating-from-1.0.md](docs/migrating-from-1.0.md).

### Added

- A reference-parser oracle in `oracle/` (#7): `@babel/parser` 8.1.2 and `oxc-parser` 0.159.0, consensus verdicts
  (exact versions in `oracle/package.json` and its own lockfile), and a CI job `Oracle replay` that regenerates the
  verdicts and replays them against this grammar through the tree-sitter API (accepted inputs must have no `ERROR`,
  `MISSING` or zero-width node and the expected node kinds; rejected inputs must have an error at the expected place).
  Each grammar or scanner fix below adds its inputs as oracle cases, passing cases and regression expectations
  (158 cases at the tag: 118 accept, 29 syntax, 6 early, 5 disagree). J2's error shows only in the TS/TSX grammar; the standalone oracle
  checks the JavaScript tree of those inputs.
- Corpus entries for every fix below in `test/corpus/` (`tree-sitter test`: 144/144 at the tag, 116 at `v1.0.0`).
- `examples/components.jsx`, a JSX example of the J1, J3 and J3b forms, parsed by CI in standalone JavaScript. In TSX
  it still needs tree-sitter-typescript's bare-ampersand scanner fix and the J3b patch.

### Changed

- Resolve the ambiguous `using` forms as ECMAScript does, like Babel and oxc (J4, #12): `using [a] = b;` is a
  subscript assignment; `using` followed by a line break and a name is two statements; `await using` followed by a
  line break and a name is an `await` expression and a separate statement. 1.0.0 read all three as a
  `using_declaration`.
- `for (using` + line break + `x of y);` and `for (using` + line break + `of of y);` are errors now (J5, #13), as
  in Babel, oxc and TypeScript (no line terminator after `using`); 1.0.0 parsed them as `for_in_statement`. A line
  break after `await using` in a `for` header is still accepted (see Known limitations).
- `<class></for>` and similar element pairs with reserved-word names parse without an error (J3, #10): the grammar
  reads the two element names and does not compare opening and closing tag names, as it never did for `<a></b>`.
  1.0.0 gave an `ERROR` because the names were reserved words.
- Numeric symbol ids and underlying grammar names change (J2 #9, J3 #10, J3b #15), because keywords are lexed in more
  positions and aliased to the usual kinds, and one hidden rule is added. Public kinds and fields do not change. In
  standalone JavaScript a keyword after `.`/`?.` is now lexed as the keyword token and aliased to `property_identifier`,
  so `GrammarName()`/`GrammarId()` of that node change (`a.class`: `identifier`/1 to `class`/54 at the time of J2);
  later changes shift the numeric ids again (J3b: `member_expression` 211 to 212, `property_identifier` 264 to 265; #24: `for_statement` 162 to 163,
  `property_identifier` 265 to 266).
  Consumers that store numeric `KindId()` values or read the grammar name must recompute them.
- Recovery trees of invalid input change, all still errors (J2: `a..class`, `a?. .class`, `a.?.class`, `a.[class]`;
  J3: `<class />>`, `<a class= />`; J3b: `<this. />`, `<this.#a />`; J4/J5: error ranges of invalid `using` forms).
- `src/scanner.c` carries the JSX bare-ampersand fix (origin PR #388's scanner hunks, identical to go-treesitter patch
  record 0001; J1) and ASCII-only digit checks for character references (J1b), so it no longer equals that record's
  result. `src/parser.c`, `src/grammar.json` and `src/node-types.json` are regenerated with tree-sitter CLI 0.27.2
  (`generate --abi 15 --js-runtime native`).
- Versions: manifests and `tree-sitter.json` `metadata.version` are `2.0.0` (the generator compiles it into
  `src/parser.c`).
- Generated size: `src/parser.c` is 3,135,009 bytes with 2,048 parse states (2,855,926 bytes and 1,870 states at
  `v1.0.0`, +9.8 %). #24 shares the plain `for` header states between the declaration initializers (a hidden rule
  `_for_declaration`), which takes 4.4 % off the J5 grammar with identical trees; the rest of J5's cost is kept.
- CI action bumps (#2, #4, #5: `tree-sitter/parse-action` 5, `actions/setup-node` 7, `actions/checkout` 7) and README
  (#6): the CI badge points at this repository, the origin's crates/npm/PyPI badges are removed (this repository does
  not publish packages), and a paragraph states what the repository is.

### Fixed

- Accept a bare `&` in JSX text (J1, #8): `<p>a & b</p>`, `<p>&</p>`, `<p>&한글</p>` gave `ERROR`. A `&` that does not
  start a character reference stays in `jsx_text`; `&amp;`, `&#38;`, `&#x26;` are still `html_character_reference`.
  Scanner change and corpus entry from upstream PR
  [#388](https://github.com/tree-sitter/tree-sitter-javascript/pull/388) by Patrick Meredith (@pmeredit), fixing
  issue [#366](https://github.com/tree-sitter/tree-sitter-javascript/issues/366).
- Match character-reference digits as ASCII in the scanner (J1b, #11): on Windows (UCRT) `iswdigit`/`iswxdigit`
  accept non-ASCII digits, so `<p>&#１;</p>`, `<p>&#١;</p>`, `<p>&#xＦ;</p>` and `<p>&#x１;</p>` gave `ERROR`.
- Accept reserved words after `.` and `?.` when the grammar is extended by TypeScript (J2, #9): `a?.delete(b)` and
  `a?.class` parsed in standalone JavaScript but gave `ERROR` in the TS/TSX grammar built on this one.
  `member_expression` accepts reserved words as `property_identifier`. Grammar change and test from upstream PR
  [#378](https://github.com/tree-sitter/tree-sitter-javascript/pull/378) (commit `ef4f80bb`) by Bobby Bonestell
  (@rbonestell), fixing issue [#377](https://github.com/tree-sitter/tree-sitter-javascript/issues/377); `this`,
  `super`, `true`, `false`, `null` reference their named rules, which keeps `node-types.json` unchanged.
- Accept reserved words as JSX element, member and attribute names (J3, #10): `<class />`, `<Foo.class />`,
  `<a.delete />`, `<C in={x} />` gave `ERROR` in standalone JavaScript and TSX. Elements are `identifier`, member
  properties `property_identifier`, attribute names `property_identifier`. Approach and corpus test from upstream PR
  #378's JSX commit `d61559b5` by SegaraRai (@SegaraRai). Contextual keywords (`async`, `await`, `get`, `let`, `set`,
  `static`, `using`) are not part of the rule, so tags such as `<async.A />` keep their trees. In the TypeScript
  grammar `nested_identifier` is shared, so `namespace a.class {}` and `let x: a.class.T;` now parse (TypeScript
  6.0.3 accepts both).
- Accept `this` as the object of a JSX member tag (J3b, #15): `<this.props.Foo />`, `<this.Foo />`,
  `<this.a.b.C>x</this.a.b.C>` gave `ERROR`. A hidden rule `_jsx_this_member_expression` is aliased to
  `member_expression`. TSX needs a one-line change in tree-sitter-typescript (handed over).
- Parse `using` as a plain identifier (J4, #12): `using = 1`, `using(x)`, `using.x`, `using++`, `for (using of x)` and
  the like gave `ERROR` in JavaScript, TS and TSX (reported in tree-sitter-typescript as #380). `using` is a
  contextual keyword like `let` and `async`. In the TS/TSX grammar, `{ using as = f(); }`,
  `await using satisfies = g();` and `for (using as of y);` parse as before; the type-annotated form needs the
  tree-sitter-typescript override handed over.
- Parse a `using` declaration as a plain `for` initializer (J5, #13): `for (using x = f();;) {}` and
  `async function g() { for (await using x = f();;) {} }` gave `ERROR` in JavaScript, TS and TSX (upstream issue
  [#391](https://github.com/tree-sitter/tree-sitter-javascript/issues/391)). The initializer is `using_declaration`
  and ends at a real `;`; a line break after `using` ends the expression, as in a block. `src/node-types.json`:
  `using_declaration` is added to the types of `for_statement.initializer`.
- The `Oracle replay` CI job built the replay with a restored Go build cache, which does not track `src/parser.c`, so a
  PR's replay could run an older grammar (#14); the job now starts with an empty build cache.

### Known limitations

Not fixed in 2.0.0; tracked as GitHub Issues where a number is given:

- JSX names that conflict with TypeScript rules in TSX stay errors: `<const />`, `extends` as an element or attribute
  name, reserved words in namespace names (`<svg:true />`), reserved words other than `this` as the object of a member
  tag (`<super.Foo />`, `<class.Foo />`). The grammar does not compare opening and closing tag names (#20).
- In a `for` header or a block, a line break after `await using` or between `await` and `using`, and inside a block
  comment after `using`, is accepted; so is `for (using of of y);` (#18).
- `for (using x in o);`, `for (using x;;)` and `await using` in a non-async function
  (`function f() { await using x = g(); }`) are accepted (no early-error checks; Babel and oxc reject them).
  `await using` at module top level is valid.
- The scanner's automatic-semicolon rules accept a lone CR after `using` and names such as `in_` and `instanceof_`
  after a line break, and the TS/TSX grammars accept U+2028/U+2029 there (#17).
- Other `isw*` calls in `src/scanner.c` (`iswspace` in `scan_jsx_text` and the calls on the automatic-semicolon,
  ternary and HTML-comment paths) still use the platform classification (#16).
- `a?.b = 1;` is accepted (#19).
- TypeScript: `import x = a.class;` (and `export import`, `import x = a.class.b;`) is accepted, although TypeScript
  rejects it (TS1359); the fix belongs in tree-sitter-typescript.
- The Go binding test step of the `Test parser` CI job can reuse a restored Go build cache, which does not track the
  included `src/parser.c` ([#21](https://github.com/wotjr1649/tree-sitter-javascript/issues/21); the `Oracle replay`
  job already starts without one, #14).
- Inherited build templates: a fresh CMake build needs the tree-sitter CLI, `setup.py` tags a free-threaded CPython
  build as `cp310-abi3`, and `make install` leaves the pkg-config description empty and prefixes absolute paths
  ([#22](https://github.com/wotjr1649/tree-sitter-javascript/issues/22)).

[2.0.0]: https://github.com/wotjr1649/tree-sitter-javascript/compare/v1.0.0...v2.0.0
