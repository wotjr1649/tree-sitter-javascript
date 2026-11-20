# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Planned for v3.0.0.

### Fixed

- Parse ambiguous calls, member accesses and subscripts as await operands in forms such as `await (x)(y)`.
  Keep `await(a).x=b` and `await[a].x ??= b` as assignments to an expression involving the identifier `await`.
- Parse `let [a]` in `for await (let [a] of b)` as an array binding pattern.

### Changed

- `await++\n(a)(b);` and `await/*\n*/++(a).x;` still form one statement and now parse as await expressions.
- `await(a)(b;` still has a missing closing parenthesis, now in a call inside the await operand.
- `for await(let [a] of) {}` still has a missing right-hand identifier and now has an array pattern on the left.
- `for await (let[0] of b)` now has a syntax error because `0` cannot bind a declaration.
- `for await (let[a] in b)` still parses without an error and now has an array pattern on the left.
- In async code, `await a=b` and `await a+=b` now produce a syntax error.
- Recovery for `new f() = 1;` places the call under the constructor. Recovery for `a?.delete(;` places an
  `ERROR` at the opening parenthesis.
- Invalid `await using [] = null;` recovers as an assignment with an `ERROR` over `using []`. An invalid
  initializer in `for await (let [x] = 0 of [])` puts the array pattern inside the `ERROR` node.

### Known limitations

- Await disambiguation does not yet track whether the enclosing context allows the keyword (#35).
  In a non-async script or function body, `await (x)(y)`, `await (a).b()`, and `await [0].x` can parse as await
  expressions even when `await` is an identifier. `await[a]++` can parse as an await of an update to the
  array literal `[a]`. This also affects nested non-async functions and arrows, for example
  `async function f(){return ()=>await(a)(b);}`.

## [2.2.0] - 2026-11-20

A minor release: the scanner inserts automatic semicolons it missed in class bodies and after declarations, reads
identifiers such as `in_` after a line break, and accepts U+0000 in templates (J7, #29). An unescaped LF or CR
immediately before a string's closing quote is now an error, as are CR, U+2028 and U+2029 inside a regular expression
literal. No breaking change under the SemVer rule in `AGENTS.md`, where valid input is input that `@babel/parser` and
`oxc-parser`, as pinned in `oracle/`, both accept. The comparison with v2.1.0 (`oracle/replay -dump`,
`scripts/tree-diff.mjs`) found no changed-clean trees over 56,138 inputs: the 474 default inputs (corpus, examples,
highlight, tags, oracle cases), 1,068 N-of-M inputs and the 54,596 inputs that the discovery run labels valid (test262
positive tests, Babel JSX fixtures, npm files; 7 of them, Annex B tests, are accepted by Babel only). The nine inputs
that became errors (five string and regular expression literals of that kind, and four `for` heads in which `using` is
followed by an LF and a name such as `in_`) are rejected by both reference parsers. `src/node-types.json` is
byte-identical to 2.1.0: no node kind, field or type is added, removed or renamed. 32 inputs that gave an error parse
now, and 3 that are an error before and after get a different recovery tree. The grammar name, the C symbol and ABI 15
are unchanged.

### Added

- Corpus entries and oracle cases for J7 (`tree-sitter test`: 172/172 at the tag, 165 at `v2.1.0`; 292 oracle cases
  at the tag, 237 accept, 39 syntax, 6 early, 10 disagree; 184 at `v2.1.0`). 92 of the cases (`j7/fix2-*`) pin the
  2.1.0 trees of valid input that combines white space, line terminators, line and block comments with the forms below.
  Eight of them end in U+2028 or U+2029 after a lone CR and two comments; they check only that the tree is clean and the
  comment ranges, because the statement that holds the first comment depends on the platform (#16, see Known
  limitations).

### Changed

- An unescaped LF or CR immediately before a string's closing quote is now an error, as are CR, U+2028 and U+2029 inside
  a regular expression literal (J7; ECMA-262 §12.9.4, §12.9.5): `'a` + LF + `'` and `'` + CR + `'`, which 2.1.0 skipped
  as white space, and `/` + CR + `/` and `/a` + U+2029 + `b/`, which 2.1.0 read as pattern characters. Babel and oxc
  reject them (11 test262 negative tests of the discovery run). A line break elsewhere in a string and an LF in a
  regular expression were already errors in 2.1.0; U+2028 and U+2029 in strings and an escaped line break (`'a\` + LF +
  `b'`) stay valid and keep their trees.
- `for (using` + LF + `in_ = f();;) {}` (also with `in$`, `in0` or `instanceof_`, and with CRLF, U+2028 or U+2029
  instead of the LF) is an error now (J7, #17); 2.1.0 read a `using_declaration`. ECMA-262 forbids a line terminator
  between `using` and its binding, and the semicolons that separate the parts of a `for` header are not inserted
  automatically, so the text has no valid reading; Babel, oxc and TypeScript reject it. With a lone CR it is still read
  as a `using_declaration` (#17, see Known limitations).
- Recovery trees change for input that is an error before and after (J7): in the comparison
  `export {a} from 'x' with {['type']: 'json'};`, `<a extends="y" />` and a test262 file with U+0000 in a string
  literal (see Known limitations); and a regular expression recovered after a block comment that holds a CR, CRLF,
  U+2028 or U+2029 followed by U+0000 (the `regex_pattern` ends before the line terminator).
- The grammar gains two external tokens, `_binding_end` and `_keyword_continues` (J7): hidden markers that the parser
  marks valid after a binding and after a keyword such as `get` or `let`, so the scanner can tell where a semicolon is
  needed. They add no node kind. tree-sitter-typescript appends its own external tokens to this grammar's list, so its
  `common/scanner.h` enum must gain both before `FUNCTION_SIGNATURE_AUTOMATIC_SEMICOLON` when it vendors this
  `grammar.js` (handed over as a patch); without it its TypeScript and TSX corpus fail 4 entries instead of 1.
- Numeric symbol ids change, because the grammar gains tokens and states: 109 of the 114 named kinds get a new id
  (`for_statement` 167 to 171, `member_expression` 199 to 204, `call_expression` 214 to 219, `property_identifier` 273
  to 278). Consumers that store numeric `KindId()` values must recompute them.
- Versions: manifests and `tree-sitter.json` `metadata.version` are `2.2.0` (compiled into `src/parser.c`).
- Generated size: `src/parser.c` is 3,328,897 bytes with 2,233 parse states and 278 symbols (3,212,460 bytes, 2,105
  states and 273 symbols at `v2.1.0`, +3.62 %); `src/scanner.c` grows from 12,386 to 14,826 bytes. The release gates
  moved to this release; the node-kind snapshot does not change.

### Fixed

- Insert the automatic semicolon after a class field when the next line starts a generator method or a computed member
  (J7; 20 test262 tests): `class C { x` + line break + `*g() {} }` and `class C { static x` + line break +
  `['y']() {} }` gave `ERROR`. `class C { get` + line break + `[x]() {} }` is still a getter, and a field with an
  initializer still continues into the next line (`x = a` + line break + `* b`, `x = 1` + line break + `[k]`).
- Insert the automatic semicolon after a `let` or `var` declaration when the next line starts with `<` or `[` (J7; Babel
  JSX fixture `jsx/basic/asi`): `{let a` + line break + `<a/>}` and `var a` + line break + `[0].forEach(f)` gave
  `ERROR`. `let` + line break + `[a] = b` is still a destructuring declaration.
- Read identifiers that begin with `in` or `instanceof` after a line break as identifiers (J7, part of #17): `a` + line
  break + `in_b`, `in$`, `in0` or `instanceof_b` gave `ERROR`, because the scanner took the prefix for the operator.
- Accept U+0000 in a template (J7): `` `a<U+0000>b` `` gave `ERROR`; the scanner took it for the end of input.

### Known limitations

Not fixed in 2.2.0; tracked as GitHub Issues where a number is given:

- No automatic semicolon after a block comment that holds a line terminator
  ([#39](https://github.com/wotjr1649/tree-sitter-javascript/issues/39)): `a /*` + line break + `*/ b`, `''/*` + line
  break + `*/''` and `let x = 1 /*` + line break + `*/ x++` give `ERROR` (test262 `language/comments/multi-line-asi-*`,
  4 tests). J7 left it out because every attempt changed clean trees of other valid input. For the same reason a
  comment between a declaration and a next-line `<`, `[` or `*` keeps the error (`{let a` + line break + `/*c*/<a/>}`).
- A lone CR (U+000D) is not a line terminator for automatic semicolons (#17): `a` + CR + `b` and `this` + CR + `{}` give
  `ERROR`, and `for (using` + CR + `x = f();;) {}` and `for (using` + CR + `in_ = f();;) {}` are read as a
  `using_declaration`, although Babel, oxc and TypeScript reject them. The TS/TSX grammars, whose scanner checks only
  LF, also accept U+2028/U+2029 there. The `in_`/`instanceof_` part of #17 is fixed in this release for LF, CRLF, U+2028
  and U+2029, not for a lone CR.
- Valid input that parses without an error but with a wrong tree, found by the structure comparison (#30); fixing them
  changes those trees, so they wait for v3.0.0: `await (x)(y)`, `await (a).b()` and `await[0]` in async code read
  `await` as a called identifier (#32; seen in 48 npm files); `for await (let [a] of b)` reads `let [a]` as a subscript
  (#32); sloppy-mode `yield` as an identifier (`yield + 1`) and `await(x)` outside async code are read as keywords
  (#35, upstream #303); statement boundaries such as `export default function(){};`, `export` + line break + `{}`,
  `return` + lone CR or U+2028/U+2029, and `for (using of of [0]);` (#33); a statement that starts with `{a: 0}` is read
  as an object instead of a block (#34, upstream #259).
- 28 of the 54,596 inputs that the discovery run labels valid still give an error (49 at `v2.1.0`), all from test262:
  11 with sloppy-mode `yield` as an identifier (#35), 4 block-comment ASI (#39), 3 `export default` boundaries (#33),
  3 hashbang lines ended by CR, U+2028 or U+2029, 4 with U+0000 in a string literal (below), 2 class fields named `get`
  or `set` before a next-line generator (`get` + line break + `*g() {}`; J7 left them out, +1.77 % `parser.c`), and the
  Annex B `0/*` + line break + `*/-->` (kept out to keep the tree of the clean `0/*` + line break + `*/--> c`).
- U+0000 in a string literal or a comment gives an error: the generated lexer stops there, which the grammar cannot
  change (J7 fixed it for templates, which the scanner reads).
- J8 accepts some invalid input: `import { if } from 'x'` and `export { if }`; call expressions beyond the
  web-compatible form as assignment targets (`import('x') = 1`, `f?.() = 1`, tagged templates, `super() = 1`,
  `typeof f() = 1`), and `f() = 1` also in strict code and modules; in `for (async of => {};;)` a line break after
  `async` or before `=>` (ECMA-262 §15.9 forbids it; rejecting it costs +1.2 % to +5.3 % `parser.c`).
- Invalid input that stays accepted, found by the discovery run, with the stricter grammar planned for v3.0.0: optional
  chains as assignment, update or destructuring targets (`a?.b = 1`, `a?.b++`, `[a?.b] = c`; #19), class declarations as
  the body of `if`, loops and labels, an arrow function as an operand of a binary operator, `??` mixed with `||`/`&&`
  without parentheses, and `class extends` with an expression that is not a LeftHandSideExpression.
- JSX names that conflict with TypeScript rules in TSX stay errors: `<const />`, `extends` as an element or attribute
  name, reserved words in namespace names (`<svg:true />`), reserved words other than `this` as the object of a member
  tag (`<super.Foo />`, `<class.Foo />`). The grammar does not compare opening and closing tag names (#20).
- `using` line breaks (#18): in a `for` header a line break after `await using` or between `await` and `using`, and a
  line break inside a block comment after `using`, are accepted; so is `for (using of of y);`. In a block in an async
  function, `{ await` + line break + `using x = g(); }` is accepted and read as `await;` and a `using_declaration`,
  although the line break is not allowed there (Babel early error, oxc syntax error); in a non-async function in a
  script the same text is valid and that reading is right. Valid forms with a wrong tree: in a block, `{ using /*` +
  line break + `*/ x = f(); }` (`using;` and an assignment, as Babel and oxc read it) and, in an async function,
  `await using /*` + line break + `*/ x = g();` are read as a `using_declaration`, which misses the line break.
  Rejecting `for (using of of y);` changes the tree of the valid `for (using of of [1, 2]);`, and the block-comment fix
  changes valid trees, so these wait for v3.0.0.
- `await using` in a non-async function (`function f() { await using x = g(); }`) is accepted, although the ECMAScript
  grammar excludes it; Babel and oxc reject it (#26). It needs the await context of the v3.0.0 work (#35).
  `await using` at module top level and in async functions is valid.
- Early errors are a non-goal (ADR-0001): for example a `using` declaration without an initializer,
  `for (using x;;);`, and duplicate import attribute keys are accepted.
- Other `isw*` calls in `src/scanner.c` (`iswspace` in `scan_jsx_text` and the calls on the automatic-semicolon,
  ternary and HTML-comment paths) still use the platform classification (#16), so a few inputs get a different clean
  tree on Windows (UCRT) than in the C locale (Linux): for example in `a//c` + CR + `/**/` + U+2028 at the end of
  input, Windows skips U+2028 as white space and puts the first comment in the statement, the C locale puts it in
  `program`. Eight oracle cases of this form check only what holds on both (see Added). The new
  check for an identifier after `in`/`instanceof` uses an explicit list rather than `iswalpha`, so for rare non-ASCII
  letters its result can differ from the platform classification used before.
- The node-kind snapshot gate does not check the types of `children` or the `multiple` and `required` flags (#38); in
  this release `src/node-types.json` does not change at all.
- TypeScript: `import x = a.class;` (and `export import`, `import x = a.class.b;`) is accepted, although TypeScript
  rejects it (TS1359); the fix belongs in tree-sitter-typescript. The J8 fixes for the import line break,
  tagged-template escapes, `f() = 1` and the attribute restriction need their own changes in tree-sitter-typescript's
  `define-grammar.js` (handed over); `f() += 1` and the `for` heads follow by inheritance. The J7 scanner rules do not
  reach TS/TSX, which use their own scanner; vendoring this `grammar.js` there needs the two external tokens in its
  `scanner.h` (see Changed).
- Inherited build templates: a fresh CMake build needs the tree-sitter CLI, `setup.py` tags a free-threaded CPython
  build as `cp310-abi3`, and `make install` leaves the pkg-config description empty and prefixes absolute paths
  ([#22](https://github.com/wotjr1649/tree-sitter-javascript/issues/22)).

## [2.1.0] - 2026-11-20

A minor release: valid syntax that gave an error now parses (J8), invalid `using` and import-attribute forms that parsed
are errors now (J6, J8), and the repository gains release gates and defect-discovery tools. No breaking change under the
SemVer rule in `AGENTS.md`, where valid input is input that `@babel/parser` and `oxc-parser`, as pinned in `oracle/`,
both accept. The comparison with v2.0.0 (`oracle/replay -dump`, `scripts/tree-diff.mjs`) found no changed-clean trees
over 56,023 inputs: the 359 default inputs (corpus, examples, highlight, tags, oracle cases), 1,068 N-of-M inputs and
the 54,596 inputs that the discovery run labels valid (test262 positive tests, Babel JSX fixtures, npm files; 7 of them,
Annex B tests, are accepted by Babel only). The eight inputs that became errors (`using` declarations in `for-in` heads,
an import attribute shorthand) are rejected by both reference parsers. No node kind, field or supertype subtype was
removed or renamed; `src/node-types.json` only gains types. 44 inputs that gave an error parse now, and 8 that are an
error before and after get a different recovery tree. The grammar name, the C symbol and ABI 15 are unchanged.

### Added

- Release gates (#27, #23): CI fails when a node kind, field, field type or supertype subtype in `src/node-types.json`
  is removed or renamed (`scripts/node-types-snapshot.mjs` against `test/node-types-snapshot.txt`; additions are
  notices). That gate does not check the types of `children` or the `multiple` and `required` flags of fields and
  children ([#38](https://github.com/wotjr1649/tree-sitter-javascript/issues/38)); for this release they come from the
  full `node-types.json` comparison under Changed. CI also reports the size of the generated parser against the last
  release (`scripts/parser-cost.mjs`, `test/parser-cost-baseline.json`: `parser.c` bytes, state, symbol, token and field
  counts, parse-table sizes) in the job summary. Each release PR moves both to the release. Tree dumps for reviews and
  release notes: `oracle/replay -dump` writes every node with its field and byte range per input, and
  `scripts/tree-diff.mjs` compares two dumps by class (same, changed-clean, clean-to-error, error-to-clean,
  error-changed); see `oracle/README.md`.
- Defect-discovery and structure-comparison tools in `oracle/discover/` (#30): pinned inputs (tc39/test262 `2e58f87d`,
  Babel JSX parser fixtures `24f41d12`, 29 npm packages by version and tarball hash, used as data only), verdicts of
  `@babel/parser` 8.1.2 and `oxc-parser` 0.159.0 against this grammar, minimisation and clustering, and a comparison of
  Babel's AST ranges with the tree of valid, error-free input to find wrong trees without an `ERROR` node. Outputs go to
  the git-ignored `build/`. The J8 fixes and the Known limitations below come from its first run.
- Corpus entries and oracle cases for J6 and J8 (`tree-sitter test`: 165/165 at the tag, 144 at `v2.0.0`; 184 oracle
  cases at the tag, 133 accept, 35 syntax, 6 early, 10 disagree; 158 at `v2.0.0`).

### Changed

- `for (using x in o);` and `for (await using x in o);` are errors now (J6, #28, #26): ECMA-262 §14.7.5 passes `~Using`
  to the `for-in` declaration, and Babel and oxc reject both. `for (using in o)`, `for (using.x in o)`,
  `for (using of x)`, `for (using x of y)`, `for await (using x of y)` and `for (await using x of y)` in async code keep
  their trees.
- Import attributes are restricted to a WithClause on every import and export path (J8, #31): keys are an
  IdentifierName or a string and values a string, so `import a from 'x' with {type: 1}`, numeric or computed keys,
  spread, shorthand properties and methods are errors now; 2.0.0 parsed the one-line import forms without an error.
  The tree is still `import_attribute` → `object` → `pair`.
- A `with` statement on the line after an import or export, `import a from 'x'` + line break + `with (o) {}` or
  `export * from 'x'` + line break + `with (o) {}`, is an error now (it is invalid in a module): the line break before
  `with` starts import attributes (J8).
- Recovery trees of invalid input change, all still errors (J8): exports with invalid attributes, imports with a line
  break before invalid attributes, invalid escapes in untagged templates, and logical assignments (`&&=`, `||=`, `??=`)
  to a call expression.
- `src/node-types.json` gains types and no node kind (J8): `call_expression` in `assignment_expression.left`,
  `augmented_assignment_expression.left` and `for_in_statement.left`; `string` in `pair.value`; `import_attribute` in
  the children of `export_statement`, which therefore become `multiple` (an export clause or namespace export can be
  followed by attributes). Consumers that read a single child of `export_statement`, or assume `left` is never a call,
  should handle the new types.
- Numeric symbol ids change, because the grammar gains hidden rules and a token: 107 of the 114 named kinds get a
  new id (`for_statement` 163 to 167, `member_expression` 195 to 199, `call_expression` 210 to 214,
  `property_identifier` 266 to 273). Consumers that store numeric `KindId()` values must recompute them.
- Versions: manifests and `tree-sitter.json` `metadata.version` are `2.1.0` (compiled into `src/parser.c`).
- Generated size: `src/parser.c` is 3,212,460 bytes with 2,105 parse states and 273 symbols (3,135,009 bytes,
  2,048 states and 266 symbols at `v2.0.0`, +2.47 %; J6 +0.14 %, J8 +2.33 %).
- CI: the `Test parser` job runs the Go binding test in its own steps without a Go build cache (#27, #21), and a new
  `Node kinds and parser cost` job runs the gates above.

### Fixed

- Accept import attributes on `export … from`, also after a line break before `with` (J8):
  `export * from 'x' with {type: 'json'}`, `export { a } from 'x' with {type: 'json'}`, and `import a from 'x'` + line
  break + `with {type: 'json'}` gave `ERROR`.
- Accept reserved words as module export and import names (J8): `export { a as if } from 'x'`,
  `export * as class from 'x'`, `import { if as a } from 'x'` gave `ERROR`.
- Accept `for (async of => {};;)` (J8): an arrow function with the parameter `of` as a `for` initializer gave `ERROR`.
- Accept invalid escape sequences in tagged templates (J8; upstream issue
  [#337](https://github.com/tree-sitter/tree-sitter-javascript/issues/337)): `` x`\u{0` `` and `` x`\x` `` gave
  `ERROR`; untagged templates still reject them.
- Accept call expressions as assignment targets in the web-compatible form (J8; ECMA-262 §8.6.4 and Annex B.3.9, as in
  test262 and Babel): `f() = 1`, `f() += 1`, `for (f() of x)`, `for (f() in x)` gave `ERROR`. `f() &&= 1`, `||=`,
  `??=`, `new f() = 1` and `[f()] = x` stay errors.
- The Go binding test of the `Test parser` CI job no longer reuses a restored Go build cache, which did not track the
  included `src/parser.c` (#21).

### Known limitations

Not fixed in 2.1.0; tracked as GitHub Issues where a number is given:

- Valid input that parses without an error but with a wrong tree, found by the structure comparison (#30); fixing them
  changes those trees, so they wait for v3.0.0: `await (x)(y)`, `await (a).b()` and `await[0]` in async code read
  `await` as a called identifier (#32; seen in 48 npm files); `for await (let [a] of b)` reads `let [a]` as a subscript
  (#32); sloppy-mode `yield` as an identifier (`yield + 1`) and `await(x)` outside async code are read as keywords
  (#35, upstream #303); statement boundaries such as `export default function(){};`, `export` + line break + `{}`,
  `return` + lone CR or U+2028/U+2029, and `for (using of of [0]);` (#33); a statement that starts with `{a: 0}` is read
  as an object instead of a block (#34, upstream #259).
- 49 of the 54,596 inputs that the discovery run labels valid still give an error (69 at `v2.0.0`), all from test262 and
  one Babel JSX fixture, none from npm. Most are scanner cases that J7 (#29, planned for v2.2.0) addresses: automatic
  semicolons in class fields before a next-line generator or computed member and after a block comment holding a line
  terminator, a lone CR (#17), `let a` + line break + JSX, U+0000 in templates. Sloppy-mode `yield` as an identifier,
  `export default` boundaries and hashbang cases wait for v3.0.0.
- J8 accepts some invalid input: `import { if } from 'x'` and `export { if }`; call expressions beyond the
  web-compatible form as assignment targets (`import('x') = 1`, `f?.() = 1`, tagged templates, `super() = 1`,
  `typeof f() = 1`), and `f() = 1` also in strict code and modules; in `for (async of => {};;)` a line break after
  `async` or before `=>` (ECMA-262 §15.9 forbids it; rejecting it costs +1.2 % to +5.3 % `parser.c`).
- Invalid input that stays accepted, found by the discovery run, with the stricter grammar planned for v3.0.0: optional
  chains as assignment, update or destructuring targets (`a?.b = 1`, `a?.b++`, `[a?.b] = c`; #19), class declarations as
  the body of `if`, loops and labels, an arrow function as an operand of a binary operator, `??` mixed with `||`/`&&`
  without parentheses, and `class extends` with an expression that is not a LeftHandSideExpression.
- JSX names that conflict with TypeScript rules in TSX stay errors: `<const />`, `extends` as an element or attribute
  name, reserved words in namespace names (`<svg:true />`), reserved words other than `this` as the object of a member
  tag (`<super.Foo />`, `<class.Foo />`). The grammar does not compare opening and closing tag names (#20).
- `using` line breaks (#18): in a `for` header a line break after `await using` or between `await` and `using`, and a
  line break inside a block comment after `using`, are accepted; so is `for (using of of y);`. In a block in an async
  function, `{ await` + line break + `using x = g(); }` is accepted and read as `await;` and a `using_declaration`,
  although the line break is not allowed there (Babel early error, oxc syntax error); in a non-async function in a
  script the same text is valid and that reading is right. Valid forms with a wrong tree: in a block, `{ using /*` +
  line break + `*/ x = f(); }` (`using;` and an assignment, as Babel and oxc read it) and, in an async function,
  `await using /*` + line break + `*/ x = g();` are read as a `using_declaration`, which misses the line break.
  Rejecting `for (using of of y);` changes the tree of the valid `for (using of of [1, 2]);`, and the block-comment fix
  changes valid trees, so these wait for v3.0.0.
- `await using` in a non-async function (`function f() { await using x = g(); }`) is accepted, although the ECMAScript
  grammar excludes it; Babel and oxc reject it (#26). It needs the await context of the v3.0.0 work (#35).
  `await using` at module top level and in async functions is valid.
- Early errors are a non-goal (ADR-0001): for example a `using` declaration without an initializer,
  `for (using x;;);`, and duplicate import attribute keys are accepted.
- The scanner's automatic-semicolon rules accept a lone CR after `using` and names such as `in_` and `instanceof_`
  after a line break, and the TS/TSX grammars accept U+2028/U+2029 there (#17; J7, #29).
- Other `isw*` calls in `src/scanner.c` (`iswspace` in `scan_jsx_text` and the calls on the automatic-semicolon,
  ternary and HTML-comment paths) still use the platform classification (#16).
- TypeScript: `import x = a.class;` (and `export import`, `import x = a.class.b;`) is accepted, although TypeScript
  rejects it (TS1359); the fix belongs in tree-sitter-typescript. The J8 fixes for the import line break,
  tagged-template escapes, `f() = 1` and the attribute restriction need their own changes in tree-sitter-typescript's
  `define-grammar.js` (handed over); `f() += 1` and the `for` heads follow by inheritance.
- Inherited build templates: a fresh CMake build needs the tree-sitter CLI, `setup.py` tags a free-threaded CPython
  build as `cp310-abi3`, and `make install` leaves the pkg-config description empty and prefixes absolute paths
  ([#22](https://github.com/wotjr1649/tree-sitter-javascript/issues/22)).

## [2.0.0] - 2026-11-19

The first release of this independent repository after the `v1.0.0` baseline (origin `tree-sitter/tree-sitter-javascript`
v0.25.0 behaviour, `src/` byte-identical to it). The grammar and scanner fixes below make valid inputs, which
`@babel/parser` 8.1.2 and `oxc-parser` 0.159.0 both accept, parse without `ERROR` or `MISSING` nodes, in standalone JavaScript and, where it
applies, in the TypeScript/TSX grammars built on this `grammar.js` (tree-sitter-typescript `59fc4ed` + #357). In
TS/TSX the scanner fixes (J1, J1b) need the same change in tree-sitter-typescript's own scanner, and J3b and J4's
type-annotated form need the patches handed over to it.
Breaking: 16 valid inputs (Babel and oxc accept them) that 1.0.0 parsed without an error get a different tree,
because 1.0.0 read them wrongly (`using [a] = b`, `using` followed by a line break and a name); this makes the release
major. In the measurement over 1,068 distinct inputs, 18 of the 533 that 1.0.0 parsed without an error change: those
16, and 2 invalid inputs that 1.0.0 accepted and that are an error now (`for (using` + line break + `x of y)` and
`... of of y)`, a minor change). No node kind or field is removed or renamed, the grammar name and
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
- Parse time and memory, one shared Windows machine (Intel Core Ultra 9 285H), v1.0.0 and 2.0.0 alternating in 20
  paired rounds of the same run: parsing `typescript.js` (TypeScript 6.0.3, 9.1 MB) took 1.46 % longer (median
  1.722 s against 1.697 s), the combined parse time for the three example files 1.30 % longer. The median peak working
  set was 238.70 MiB against 238.59 MiB for `typescript.js` (+0.05 %) and +0.34 % for the largest of the three example
  processes. All observed ranges overlap. CPU load (10-second average) was 57.6 % at the start and 68.7 % at the end.
  These are one-machine comparison numbers, not a benchmark.
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
- `for (using x in o);` and `await using` in a non-async function (`function f() { await using x = g(); }`) are
  accepted, although the ECMAScript grammar excludes them; Babel and oxc reject them (#26). `await using` at module
  top level and in async functions is valid.
- Early errors are a non-goal (ADR-0001): for example a `using` declaration without an initializer,
  `for (using x;;);`, is accepted.
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

[2.2.0]: https://github.com/wotjr1649/tree-sitter-javascript/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/wotjr1649/tree-sitter-javascript/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/wotjr1649/tree-sitter-javascript/compare/v1.0.0...v2.0.0
