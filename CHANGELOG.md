# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking changes

- Automatic semicolon insertion (ASI) can change statement and declaration boundaries around comments. In
  `let x\r//\r;` the explicit semicolon belongs to the declaration, with no sibling `empty_statement`.
  `async /*\n*/ x => x` becomes an identifier statement followed by an ordinary arrow. In
  `{ using /*\n*/ x = f(); }`, `using` is an identifier statement followed by an assignment. These boundaries
  agree with Babel (#46, #17, #39, #18).
- An expression can continue across the same trivia. In `export default a\n//x\r/*z*/(b)`, the call becomes
  the default export's value. `a\n//x\r/*z*//b/g` becomes a division chain in one statement, matching Babel's
  expression structure. Comment attachment can also move while the statement structure agrees with Babel,
  as in `a /* \0 */\nb` (#46).
- Class members can split or combine across line terminators. `class A{async\n*g(){}}` has an `async` field
  followed by a synchronous generator. `class A {static get\n/*c*/*g(){}}` has a static `get` field followed
  by a generator. `class A{get/*\n*/[x](){}}` has one computed accessor, and
  `class A{static/*\n*/*g(){}}` has one static generator. The member kinds and boundaries agree with Babel
  (#46, #49).
- Annex B comments can change both the surrounding expression and the comment range. Babel's Script parse of
  `f(x\n/*c*/-->z\n+y);` has one argument, `x + y`, and the CST now has that same expression.
  In `<!--x\rnext();`, the `html_comment` ends before the CR and `next()` is a separate call, matching
  Babel's Script ranges. With CRLF, the comment also ends before the CR. This moves the ends of comment
  nodes in test262's single-line HTML comment fixtures (#46, #49, #55).
- Recognise Script `<!--` at statement boundaries after a line terminator in the source or inside
  a block comment.
  In `a\n/**/<!--x\rb` and `a/*x\ny*/<!--x\rb`, `<!--x` is an `html_comment` and `a` and `b`
  are separate expression statements. The two statement ranges and the HTML comment range match Babel
  in both examples (#55).
- Function context can change identifier and operator nodes. In `function f(){ return await(x)(y); }`,
  Babel and the CST read two nested calls. In `function* f(){ return ()=>yield(x); }`, they read a call in
  the ordinary arrow. In `function* f(){ function g(x = yield(1)){ return yield(x); } yield 2; }`, the default
  value and ordinary function body use calls, and the outer generator uses a yield expression (#35, #36).
- Parse a bare ampersand immediately before either JSX attribute closing quote as a
  `string_fragment`, including when U+0000 precedes the ampersand. In both examples below, v3.1.0
  produces one attribute followed by a JavaScript comment. The corrected CST has two attributes,
  `x` and `y`, with `/> //` inside the quoted value of `y`, matching Babel's attribute boundaries
  (#45, #50).

~~~jsx
<a x="&" y='" /> //' />
<a x='&' y="' /> //" />
~~~

- In quoted JSX attributes, whitespace before a complete character reference can become a separate
  `string_fragment`. In `<a b='&&amp;'/>`, the first `&` is a `string_fragment` and `&amp;` is an
  `html_character_reference`. In `<a b="&&"/>`, two `string_fragment` nodes replace one. Comment-like
  text in quoted attributes can become string content, changing comment nodes and fragment boundaries
  in valid input.

### Fixed

- Count lone CR and line terminators in block comments for ASI. `a\rb`, `a/*\n*/b` and
  `let a=b/*\n*/++c` parse with the required statement break. Identifiers such as `in_` and `instanceof_`
  after a CR or a comment can start a new statement. Preserve continuations through comments before a
  declarator, initializer, call, computed method name or tagged template, including the initializer in
  `for(using a\n//x\r/*z*/=b;;);` (#46, #17, #39).
- Parse `get` and `set` fields before a next-line generator, including `class A { get\n*g() {} }`. Preserve
  a static `get` field in `class A{static/*\n*/get\n*g(){}}`. A line terminator after an `async` field
  can also separate a following computed method (#46, #49).
- Recognise Annex B close comments after line-start block comments and preserve the surrounding expression
  (#46, #49).
- Accept U+0000 inside Annex B opening and closing comments. In `<!--\0\rnext();` and `-->\0\rnext();`,
  the NUL stays in the comment and the call starts after the CR. A NUL after the CR, outside the comment,
  is a syntax error. The HTML-like comment changes for CR and U+0000 were deferred from #48 and are in #55.
- Use the enclosing context for `await` and `yield` at function, method, arrow and class boundaries.
  Sloppy Script forms such as `var yield; yield=1;` can use `yield` as an identifier. A concise arrow's
  expression can continue across a CR-terminated line comment or across included ranges (#35, #36).
- Report a syntax error for `for (using\rx = f();;) {}` and `for (using /*\n*/ x = f();;) {}` (#17, #18,
  #46). The await/yield context fix also rejects `function f(){ await using x = y; }` and the tested
  `await using` loop forms in ordinary functions (#26, #35).

- Treat `<!--`, `-->`, `//`, `/* ... */` and incomplete character references as string content inside
  quoted JSX attributes, including when they occur alongside `U+0000`.

### Changed

- Adjust recovery ranges for character references, string fragments and error or missing nodes in
  malformed JSX attributes. Report an error in some inputs with invalid text after the closing quote.

### Performance

- Move quoted JSX attribute lexing to the external scanner. The generated JavaScript main lexer has
  264 states and can be optimised by the C compiler.

### Approved normalisations

- Ambiguous top-level `await` follows the Module reading. For `await(x)(y);`, the CST agrees with Babel
  in Module mode. Babel's Script parse uses nested calls. Script-only bindings named `await` can still
  differ, including the binding in the test262 dynamic-import attributes fixture (#35, #36).
- At the top level, inline `<!--` in `x = -1 <!--x;` follows Babel's Module expression structure.
  Babel's Script parse ends the assignment before an HTML-like comment. The parser API has no Script/Module
  selector (#41, #46, #49).
- For static import and re-export attributes, the structure comparison normalises the `object` and its
  direct `pair` children under `import_attribute` to compare with Babel's attributes. The key and value
  ranges are still compared. The public CST retains these wrapper nodes, for example in
  `export * from 'x' with {type: 'json'}` (#41).
- In test262's `generator-function-expression.js`, trailing `/* after */` comments attach inside the
  initializers and extend the `generator_function` and `variable_declarator` ranges. The executable
  structure agrees with Babel when comment placement and the affected ranges are disregarded (#46).
- In `f(x/*\n*/--> z\n+ y);`, one `html_comment` spans the line-terminating block comment and its close
  suffix. Babel exposes separate block and HTML comment ranges. Both expose `x + y` as the argument.
  The combined CST range follows the multiline-comment production with a close suffix.
  [ECMA-262 B.1.1](https://tc39.es/ecma262/multipage/additional-ecmascript-features-for-web-browsers.html#sec-html-like-comments)

## [3.1.0] - 2026-11-21

This minor release adds JSX reserved-word names and fixes U+0000 handling (#20, #45). The Windows comparison
with v3.0.0 covered 57,113 records across the default inputs (corpus, examples, highlights, tags and oracle),
the fixed N-of-M set, and the 54,596 pinned inputs labeled valid by Discovery. It found zero changed clean CSTs
and zero clean-to-error records for valid inputs. For the release's SemVer rule, valid input is input accepted
by both `@babel/parser` and `oxc-parser` as pinned in `oracle/`. Discovery also includes positive tests based on
test262 metadata. The grammar is `javascript`, the C entry point is `tree_sitter_javascript`, the parser ABI is 15,
and `src/node-types.json` is byte-identical to v3.0.0.

### Added

- Accept reserved words in JSX tag and attribute names, including namespace components and member names.
  Examples include `<const />`, `<a extends="y" />`, `<svg:true />` and `<super.Foo />` (#20, #54).

### Fixed

- Parse U+0000 in string literals and their escape sequences, template literals, regular-expression patterns,
  line and block comments, hashbang comments, JSX text, and quoted JSX attributes (#45, #48).
- Parse a JSX attribute entity candidate interrupted by U+0000 as a `string_fragment` in either quote style.
  Complete entities retain `html_character_reference`. Preserve the v3.0.0 tokenization when a bare `&`
  precedes a closing attribute quote (#45, #48, #53).
- In the Windows comparison, 80 default, 83 N-of-M and four Discovery records moved from error to clean.
  Both reference parsers accept all 167. The Discovery records are one test262 template literal and three
  test262 regular-expression tests containing U+0000. Fifteen records that still report errors have
  different recovery CSTs.

### Changed

- A bare brace attribute requires a spread (`<a {...props} />`), and a braced attribute value requires a
  non-empty expression (`<a x={value} />`). Previously accepted invalid forms such as `<a {x} />` and
  `<a x={} />` now give errors. Empty and comment-only brace expressions are still allowed as children.
  The two clean-to-error records in the Windows comparison contain the same empty-valued attribute in
  different source contexts. Both reference parsers reject both records (#20, #54).
- The manifests and their own lockfile entries carry version 3.1.0. The generated parser metadata carries the
  same version. The release gate baselines were refreshed. The node-type snapshot checks kind, field, field-type
  and supertype-subtype removals. Direct `children` types and the `multiple` and `required` flags remain
  outside its coverage (#38).
- The generated `src/parser.c` is 3,427,488 bytes (+47,644 bytes, +1.41% from v3.0.0) with 2,263 states
  (+7, +0.31%). Consumers that persist numeric symbol IDs should refresh them when switching parsers.
- tree-sitter-typescript vendors this grammar. Apply its matching grammar and scanner changes when vendoring
  v3.1.0. Those changes are handed to tree-sitter-typescript separately.

### Known limitations

- HTML-like comments use the v3.0.0 scanner behavior. U+0000 in an HTML-like comment still gives an error.
  A lone CR may still leave following code inside the comment. The HTML-like comment changes for CR and U+0000
  are deferred to v4.0.0 (#46). Script-mode Annex B comment trees can differ from Babel.
- Await and sloppy-script `yield` context handling remain open (#35). In non-async code,
  `await (x)(y)` or `await[a]++` can parse as an await expression. In an async function, `await (a).x=b` can
  still parse as an assignment involving the identifier `await`.
- General ASI still misses some lone CRs (#17) and line terminators inside block comments (#39).
  #46 also tracks ASI near comments that cuts off declarations, methods or fields, and missed breaks before
  a standalone prefix update.
- In both quote styles, U+0000 immediately followed by an ampersand at the end of a JSX attribute value
  can still give an error. Both reference parsers accept the two corpus examples (#45, #53).
- JSX opening and closing tag names are parsed independently, so pairs such as `<a></b>` and `<const></span>`,
  as well as mixed fragment and named tags, can parse without an error (#20).
- Line-break cases involving `using` and `await using` remain in #18. In an async block, `await\nusing x = g();`
  can parse as two statements even where the references reject it. A block comment with a line terminator
  after `using` in a block or after `await using` in an async function can keep an assignment inside a
  declaration. `await using` in a non-async function may still parse (#26). The early-error policy in ADR-0001
  continues to cover cases such as a bare `using` declaration and duplicate import attribute keys.
- Optional-chain assignment, update and destructuring targets remain accepted (#19). The invalid constructs
  documented under v2.2.0 also include some import and export names, call assignment targets, line breaks in
  async arrows, declarations in statement positions, arrows as operands, unparenthesized mixes of `??` with
  `||` or `&&`, and some class heritage expressions.
- The remaining Discovery areas include sloppy `yield` and `await` context, comment ASI, class
  fields named `get` or `set` before a generator, static import attribute object and pair ranges, and Annex B
  comment structure. The downstream pin and vendoring criteria remain open in #41.
- TypeScript still accepts the `import x = a.class;` family (TS1359). The separate J8 TypeScript overrides and
  inherited build template limitations (#22) continue to apply.

## [3.0.0] - 2026-11-20

This major release changes trees for inputs that already parsed cleanly in v2.2.0 and are accepted by the pinned
`@babel/parser` and `oxc-parser`. The grammar name, the C entry point and ABI 15 are preserved. The Windows
comparison with v2.2.0 covered 57,005 records across the release's default inputs (corpus, examples, highlight,
tags and oracle), the fixed N-of-M set and the 54,596 pinned inputs labeled valid by Discovery, including seven
Annex B tests accepted only by Babel. Of 355 changed clean trees, 353 agree with the Babel 8.1.2 structure
comparison. The other two records are copies of the `Objects` fixture, which both reference parsers reject
as a whole. The two changed labeled blocks in each copy agree with Babel in isolation. Both reference parsers
reject all 12 clean-to-error records. In the same comparison, 596 records moved from error to clean and 13
changed their recovery tree.

### Breaking changes

- Calls, member accesses and subscripts can move under `await_expression`. A `for await` declaration with an
  array binding now has an `array_pattern` on the left (#32).
- Default-exported functions, generators and classes can appear in `export_statement.value`. Their trailing
  semicolon becomes a sibling `empty_statement`. Export, restricted-statement and hashbang boundaries also
  change, as does the tree for `for (using of of [1, 2]);` (#33).
- Braces at the start of a statement and in an unparenthesized arrow body can form a block with a labeled
  statement. A trailing semicolon after the block is its own `empty_statement` (#34).
- Explicit character classes change lookahead and JSX text trees that depended on Windows UCRT (#42, #16).
  Declaration ASI across CR and consecutive comments changes declaration ranges and comment attachment (#44, #43).

### Fixed

- Parse ambiguous calls, member accesses and subscripts as await operands in forms such as `await (x)(y)` (#32).
  Keep `await(a).x=b` and `await[a].x ??= b` as assignments to an expression involving the identifier `await`.
- Parse `let [a]` in `for await (let [a] of b)` as an array binding pattern (#32).
- Parse the semicolon after a default-exported function, generator or class as a separate `empty_statement`, for
  example in `export default function(){};` (#33). An anonymous default-exported declaration can end without a
  semicolon before the next statement, as in `export default function(){}{}`. In `export default function(){}\n(1)`,
  `(1)` is a separate expression statement. A line break after `export` can precede an export clause or declaration
  (`export\n{}`, `export\nvar a`), keeping both lines in one `export_statement`.
- Honor automatic semicolon insertion for restricted statements using the `_restricted_keyword` scanner marker
  (#33). A lone CR, including one in a block comment, can end a `return`, `break` or `continue` statement before
  its expression or label. For example, `return\r0` is a bare return followed by an expression statement.
- Treat the first `using` in `for (using of of [1, 2]);` as the loop's identifier and `of [1, 2]` as the right-hand
  subscript expression (#33). `for (using of of);` now parses, and `for (using of of y);` now gives a syntax error.
  The `of` binding in `for (await using of of y);` is still a declaration.
- End hashbang comments at CR, U+2028 (LS) and U+2029 (PS) as well as LF (#33). The next statement or comment is
  parsed separately, and the range of a CRLF-terminated `hash_bang_line` excludes the CR.
- Parse `{a:0}` at the start of a statement and in an arrow body such as `() => {a:0}` as a `statement_block`
  containing a `labeled_statement` (#34). In `{a:0};`, the semicolon is a separate `empty_statement`. Expression
  positions such as `({a:0})` and `() => ({a:0})` still contain an `object`.
- Use explicit code-point classes for scanner whitespace and ASCII digits (#42, #16). On Windows, U+FEFF is treated
  as whitespace in scanner lookahead, and supplementary-plane code points keep their full value instead of being
  truncated to 16 bits. The block comment in `a\r\uFEFF/*c*/\n` now lies outside the expression statement. When EOF
  immediately follows `*/`, the comment remains inside the expression statement. Other affected inputs include
  `a\n\u{12000}(b)` and `a?.\u{10030}b`. With the new scanner, trees for the compared inputs were identical in
  Windows UCRT, C locale emulation and glibc-like emulation.
- Count only ASCII whitespace (U+0009 through U+000D and U+0020) when checking for blank JSX text lines (#42, #16).
  Lines containing only U+00A0 or U+3000 now yield `jsx_text`. A line break before a comment is also retained for
  semicolon insertion in `let x\n/**/[y]` and `let x\n\uFEFF/**/[y]`, which now parse as declarations followed by
  separate array expressions. The ASCII form previously recovered with an error.
- Insert an automatic semicolon after an uninitialized identifier declaration before a next-line `(`, `+`, `-`,
  regular expression or template literal (#44, #43). The 2,417 inputs of #42's 28,628-input family that regressed in
  the #42 comparison parse again. The #44 checks covered Windows UCRT, C-locale emulation and glibc-like
  emulation.
- Require an explicit semicolon after a declaration initializer in a plain `for (;;)` header, preserving the
  public declaration kind in the `initializer` field. Ordinary array and object binding patterns require an
  initializer. For example, `var [z]\n/pattern/;` reports an error, while `for (var [x] of y) {}` still uses the
  dedicated loop binding grammar (#44).

### Changed

- In Script mode, Babel reads `await++\n(a)(b);` and `await/*\n*/++(a).x;` as two statements. In Module mode,
  Babel reports `InvalidLhs` for the first input and reads the second as one `AwaitExpression` statement.
  This grammar still reads each as one statement and now parses it as an `await_expression` (#32).
- `await(a)(b;` still has a missing closing parenthesis, now in a call inside the await operand (#32). This also
  applies across line breaks in `await(a)\n(b;\nx();`. In `await[a]?.[;` the `ERROR` still covers bytes [8, 11),
  and the preceding `subscript_expression` becomes an `await_expression` with an array operand.
- `for await(let [a] of) {}` still has a missing right-hand identifier and now has an array pattern on the left (#32).
- `for await (let[0] of b)` now has a syntax error because `0` cannot bind a declaration (#32).
- `for await (let[a] in b)` still parses without an error and now has an array pattern on the left (#32).
- In async code, `await a=b` and `await a+=b` now produce a syntax error (#32).
- Recovery for `new f() = 1;` places the call under the constructor. Recovery for `a?.delete(;` places an
  `ERROR` at the opening parenthesis (#32).
- Invalid `await using [] = null;` recovers as an assignment with an `ERROR` over `using []`. An invalid
  initializer in `for await (let [x] = 0 of [])` puts the array pattern inside the `ERROR` node (#32).
- `export default function(){}()` and uses of `export` as an identifier such as `export;`, `export = 1` and
  `export: 1` now produce syntax errors (#33).
- Recovery changes for invalid export attributes such as `export {a} from 'x' with {['type']: 'json'};` and for
  `for (using of of y)` (#33). In `export {a}\nwith {a:1}`, `with` retains its `ERROR` range and the following
  braces recover as a labeled block. The same block recovery applies to invalid standalone `else{a:0}` and
  `case 1:{a:0}` (#34).
- Checking only ASCII digits after `.` and `?.` changes syntax-error outcomes and recovery trees on Windows
  (#42, #16). For example, `a?.\u0660b` previously produced an error and now produces a `member_expression`.
- In Script input such as `\u{12000}<!-- comment\nright`, Windows previously skipped the supplementary-plane
  character and produced an `html_comment`. The scanner now preserves the character and the grammar produces a
  `binary_expression`. Babel's Script parse treats `<!--` as a comment in this case (#42, #16).
- In `src/node-types.json`, `await_expression` still has one required direct child. Its declared types narrow from
  `expression` to `primary_expression`, `await_expression`, `unary_expression`, `update_expression`, `new_expression`,
  `jsx_element` and `jsx_self_closing_element` (#32). Expanding the supertypes excludes direct assignments, augmented
  assignments, binary expressions, ternaries and yield expressions. These can still be reached inside parentheses.
  `export_statement.value` adds `class`, `function_expression` and `generator_function` (#33).
- Numeric symbol IDs shift after the addition of `_restricted_keyword` (#33) and `_declaration_end` (#44), among
  other grammar changes. The first ID shifts for 95 of 114 visible named kinds, including `for_statement` from
  171 to 177, `call_expression` from 219 to 225 and `property_identifier` from 278 to 285.
- Bare declarations followed by CR and consecutive line and block comments now use the same ranges as Babel and
  oxc, which changes comment attachment and can turn a following `empty_statement` into the declaration’s
  semicolon (#44).
- The manifests and generated parser metadata carry version 3.0.0. The node-kind snapshot adds three
  `export_statement.value` types. The snapshot checks kind, field, field-type and supertype-subtype removals.
  Direct `children` types and the `multiple` and `required` flags remain outside its coverage (#38).
- The generated `src/parser.c` is 3,379,844 bytes (+50,947 bytes, +1.53% from v2.2.0) with 2,256 states
  (+23, +1.03%). Both release gate baselines move to v3.0.0.

### Migration

- Recheck queries on `await_expression` that match the old direct children and descend through
  `parenthesized_expression` where appropriate. For `export_statement`, account for the new `value` types and
  the sibling `empty_statement` after a default-exported declaration. Check sibling-sensitive queries for
  labeled blocks and declaration ASI too. Regenerate types derived from `node-types.json` and recompute stored
  numeric symbol IDs from the new parser.
- tree-sitter-typescript vendors this grammar and needs matching changes: the new external tokens
  (`_binding_end`, `_keyword_continues`, `_restricted_keyword`, `_declaration_end`) in its scanner enum, the
  await operand rules for its own expression forms, and a port of the #42 character classes to its own scanner.
  They are handed to tree-sitter-typescript separately; until then, do not vendor this release there unchanged.

### Known limitations

- Await disambiguation does not yet track whether the enclosing context allows the keyword (#35).
  In a non-async script or function body, `await (x)(y)`, `await (a).b()`, and `await [0].x` can parse as await
  expressions even when `await` is an identifier. `await[a]++` can parse as an await of an update to the
  array literal `[a]`. This also affects nested non-async functions and arrows, for example
  `async function f(){return ()=>await(a)(b);}`. Conversely, `await (a).x=b` can still parse as an assignment
  using the identifier `await` in an async function, where both reference parsers reject it.
  Sloppy-script `yield` identifiers also remain open under #35.
- General ASI still misses some lone CRs (#17) and line terminators inside block comments (#39). For example,
  `a\rb` and `a /*\n*/ b` can give errors. #46 also tracks ASI around comments that cuts off a declaration,
  method or field that should continue, and missed breaks before a standalone prefix update.
- Some tokens containing U+0000 still give an error, including string literals, comments and regular expressions.
  #45 tracks strings, templates, comments, regular expressions, hashbangs and HTML-like comments for v3.1.
- JSX tag names are parsed independently of their matching opening or closing name (#20), so `<a></b>` parses
  without an error. JavaScript still rejects valid JSX names such as `<const />`, `<a extends="y" />`,
  `<extends />`, `<svg:true />` and `<super.Foo />`, because changing these rules conflicts with TSX.
- Line-break cases involving `using` and `await using` remain in #18. In an async block, `await\nusing x = g();`
  parses as two statements despite the reference parsers rejecting this form. In a non-async function in a Script,
  the same split is valid. A block comment with a line terminator in `{ using /*\n*/ x = f(); }` or after
  `await using` in an async function can keep the following assignment inside a `using_declaration`.
  `await using` in a non-async function can still parse (#26). The existing early-error policy continues to allow
  cases such as a bare identifier in a `using` declaration and duplicate import attribute keys.
- Optional-chain assignment, update and destructuring targets remain accepted (#19). The remaining invalid
  constructs documented under v2.2.0 also include certain import and export names, call assignment targets,
  line breaks in async arrows, declarations in statement positions, arrows as operands, unparenthesized mixes
  of `??` with `||` or `&&`, and some class heritage expressions.
- The pinned Discovery run still reports 22 test262 A1 inputs. They include 11 sloppy `yield` cases, four
  block-comment ASI cases, four NUL cases, two class fields named `get` or `set` before a generator, and one
  Annex B HTML-comment case. The structure tool reports 75 test262 differences: 63 `yield` and two `await`
  context cases, nine static import attribute object and pair ranges, and one Annex B HTML-like comment. The
  Script interpretation of Annex B HTML-like comments can differ from Babel.
  The downstream pin and vendoring criteria remain open in #41.
- The TypeScript `import x = a.class;` family is still accepted by the TS grammar (TS1359). The separate J8
  TypeScript overrides and inherited build template limitations (#22) continue to apply.

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

[3.1.0]: https://github.com/wotjr1649/tree-sitter-javascript/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/wotjr1649/tree-sitter-javascript/compare/v2.2.0...v3.0.0
[2.2.0]: https://github.com/wotjr1649/tree-sitter-javascript/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/wotjr1649/tree-sitter-javascript/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/wotjr1649/tree-sitter-javascript/compare/v1.0.0...v2.0.0
