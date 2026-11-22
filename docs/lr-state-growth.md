# LR state growth from v1.0.0 to v4.4.0

Analysis of 2026-11-22. It records how many LR parse states the generated parser gained after the baseline, which
changes added them, and whether they were needed. The counts come from the committed `src/parser.c` of each tag and
commit (generated with the pinned tree-sitter CLI 0.27.2). The analysis did not regenerate any parser. An independent
read-only review with Codex reached the same attribution and verdicts.

## Totals

| | v1.0.0 | v4.4.0 | change |
| --- | ---: | ---: | ---: |
| `STATE_COUNT` | 1,870 | 2,840 | +970 (+51.9 %) |
| `LARGE_STATE_COUNT` | 387 | 469 | +82 |
| `SYMBOL_COUNT` | 261 | 314 | +53 |
| `EXTERNAL_TOKEN_COUNT` | 8 | 36 | +28 |
| `src/parser.c` bytes | 2,855,926 | 3,901,534 | +36.6 % |

`STATE_COUNT` per tag: v1.0.0 1,870; v2.0.0 2,048; v2.1.0 2,105; v2.2.0 2,233; v3.0.0 2,256; v3.1.0 2,263;
v4.0.0, v4.0.1, v4.1.0 and v4.2.0 2,854; v4.3.0 2,857; v4.4.0 2,840.

To reproduce a count:

~~~sh
git show v4.4.0:src/parser.c | grep -m1 '^#define STATE_COUNT'
~~~

## Attribution

Deltas are measured per pull request along the first-parent history of `main`, and along the first-parent history
of `next/v4` for v4.0.0. Each delta is against the PR's own base, so a PR measured on a side branch can differ from
the tag-to-tag difference.

Verdicts: **needed** fixes a demonstrated defect against the repository's targets (syntax accepted by the pinned
`@babel/parser` and `oxc-parser`, ASI, Annex B comments, `await`/`yield` context, `using`, JSX). **Design choice**
fixes a real defect, but a cheaper implementation may exist. **Duplication** is avoidable repetition of grammar
productions.

| Step | Delta | Changes | Verdict |
| --- | ---: | --- | --- |
| v1.0.0 → v2.0.0 | +178 | #10 reserved words in JSX names (+27), #12 `using` as an identifier (+24), #13 `using` in a plain `for` header (+88), #15 `<this.props.Foo />` (+89), #24 shared plain-`for` header (−50) | Needed. #24 recovered duplication from #13. #15 keeps a JSX-only root because TypeScript also uses `nested_identifier`, but it repeats the member suffix (see candidate 1). |
| v2.0.0 → v2.1.0 | +57 | #28 `using … of` in for heads (+5), #31 import attributes, reserved module names, `async of` arrows and other accepted syntax (+52) | Needed |
| v2.1.0 → v2.2.0 | +128 | #29 scanner-validity markers `_binding_end` and `_keyword_continues` across declarators, fields, property names, `await` and `yield`, plus literal line-terminator fixes | Needed defects. The broad marker placement is a design choice. Its possible savings were not measured. |
| v2.2.0 → v3.0.0 | +23 | #33 statement boundaries and `_restricted_keyword` (+15), #44 `_declaration_end` (+3), #32 `await` operand precedence (+5) | Needed |
| v3.0.0 → v3.1.0 | +7 | #48 U+0000 handling (+5), #53 trailing-ampersand trees (−5), #54 JSX names and brace attributes (+7) | Needed |
| v3.1.0 → v4.0.0 | +591 | See below | Mostly needed |
| v4.0.0 → v4.2.0 | 0 | Build, CI and scanner-only changes. #72 dropped one external token. | — |
| v4.2.0 → v4.3.0 | +3 | #76 `_declaration_end` for incremental reuse | Needed |
| v4.3.0 → v4.4.0 | −17 | #80 hyphenated JSX member heads (−21), #81 parenthesized decorators (+4) | Needed |

### v4.0.0

`next/v4` started from 2,261 states, two below the v3.1.0 tag.

| PR | Delta | States after | Change |
| --- | ---: | ---: | --- |
| #52 | +647 | 2,908 | `await` and `yield` follow the enclosing function, method, arrow or class context (11 external tokens) |
| #55 | +484 | 3,392 | Class ASI and Annex B comments around modifier, field and method heads (3 external tokens) |
| #57 | +13 | 3,405 | Sync of the remaining v3.1.0 changes |
| #56 | +7 | 3,412 | Line terminators after `yield` |
| #58 | −615 | 2,797 | Shared `_nonordinary_method_head`, removing duplicated method productions |
| merge | +1 | 2,798 | Merge of `next/v4` into `release/v4.0.0` (includes #62 and #63) |
| #66 | +56 | 2,854 | ASI after postfix updates and arrows, `await` in async arrow bodies, class field boundaries |

#52 keeps the cost low by design. ECMA-262 parameterizes expressions by `[Await, Yield]`, and copying the
expression grammar per combination would multiply its states. Here the scanner tracks the context and the grammar
marks only where a context starts and ends, with zero-width `_enter_*` and `_leave_*` external tokens. Only the
heads of functions and methods split. The largest duplication of that work, the method head, was removed in #58
before the release.

## Verdict

Most of the growth is not over-engineering. About 60 % of the added states (591 of 970) come from v4.0.0, and each PR there fixes
input that both reference parsers accept, with failing cases recorded in its PR and in `CHANGELOG.md`. The rarity
of a form in real code is not a reason to drop it while the oracle defines the target.

About 156 states, 5.5 % of the current count, remain as duplication:

1. **JSX member suffix (−86, 2,840 → 2,754).** `nested_identifier` and `_jsx_keyword_member_expression` need
   different roots but repeat the same `.` and aliased `property_identifier` tail. Sharing the tail matched CSTs
   on 735 corpus inputs, with fresh parses and one incremental edit each.
2. **Function and generator suffix (−70, 2,840 → 2,770).** The four function and generator rules repeat the
   signature, body and context exit after their distinct heads. Sharing the suffix matched CSTs on the same 735
   inputs.

Two other levers are not duplication:

- Removing `_jsx_element_name` from `inline` reduces states but changes 16 JSX error-recovery CSTs. It is a minor
  change, a trade-off rather than a cleanup.
- Adding entries to `conflicts` to merge states failed generation in all 19 variants tried.

These candidates reduce states and fix no defect. Performance work ended with v4.4.0 (AGENTS.md), so adopting them
needs the owner to reopen it first.

## Other generated-parser counts

- `LARGE_STATE_COUNT` (+82) follows from the state and symbol growth. No change targets it.
- `SYMBOL_COUNT` (+53) adds 56 symbols and removes 3. The added symbols are 28 external tokens, 5 lexer tokens
  (`satisfies`, the JSX quote pair that #63 split for the external scanner, and the NUL and invalid escape
  sequences), and 23 hidden rules and repeat helpers. Several hidden rules exist to share states:
  `_for_declaration`, `_nonordinary_method_head`, `_parameter_list` and `_arrow_parameters`.
- `EXTERNAL_TOKEN_COUNT` (+28): all 36 external tokens are referenced in `grammar.js` and in `src/scanner.c`. They
  include 9 never-produced ASI validity markers, 11 context tokens for `await` and `yield`, 2 `yield` tokens,
  1 Annex B token, 2 `await using` tokens and 3 JSX attribute tokens. Their names and order are frozen through 4.x.
- `src/parser.c` size (+36.6 %) follows from the tables. Compiled with gcc 16.2 at `-O2` (MSYS2 UCRT64), the
  `.text` of `parser.o` grows from 410,528 to 589,024 bytes and that of `scanner.o` from 2,168 to 12,488 bytes. A
  stripped benchmark executable grows from 610,816 to 799,232 bytes (+188,416, +30.8 %).

## Size and performance

The measurement used `scripts/parse-bench.c`'s workload: fresh parses, and a one-space edit followed by an
incremental parse. It timed only the parse with `QueryPerformanceCounter` and counted runtime allocations with
`ts_set_allocator`. Both versions were linked against go-tree-sitter v0.25.0's runtime with the same flags. The
input packs were the default, N-of-M and npm packs that `scripts/parse-bench.sh` builds. Each workload ran 15
paired rounds on Windows 11 with alternating order. The table gives median parse times and the interquartile range
of the paired v4.4.0/v1.0.0 ratios.

| Input set | Files | Error trees v1.0.0 → v4.4.0 | Fresh v1.0.0 → v4.4.0 | Ratio [IQR] | Incremental v1.0.0 → v4.4.0 | Ratio [IQR] |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| npm | 375 | 0 → 0 | 1,008.6 → 1,052.9 ms | 104.4 % [102.7, 107.5] | 53.1 → 52.1 ms | 98.1 % [97.1, 117.4] |
| Default | 1,449 | 887 → 95 | 78.2 → 71.5 ms | 91.4 % [85.9, 96.7] | 15.3 → 8.2 ms | 53.6 % [50.0, 56.4] |
| N-of-M | 1,068 | 535 → 108 | 56.1 → 55.1 ms | 98.2 % [94.0, 104.3] | 11.3 → 8.1 ms | 72.1 % [67.9, 77.8] |

Only npm parses without errors in both versions, so it is the like-for-like comparison. In the default and N-of-M
sets v1.0.0 builds many more error trees, and error recovery dominates the difference. The Linux Callgrind
instruction counts in `CHANGELOG.md` (v1.0.0 = 100, last full table at v4.2.0) agree on npm, with 104.07 fresh and
107.36 incremental. On Windows the npm incremental times have too wide a range to separate from that.

| Memory (npm) | v1.0.0 | v4.4.0 | change |
| --- | ---: | ---: | ---: |
| Process peak working set | 18.54 MiB | 19.03 MiB | +2.6 % |
| Tree bytes summed over files | 248,904,496 | 251,243,936 | +0.94 % |
| Largest single tree | 12,750,136 | 12,904,416 | +1.2 % |

The working set on the default and N-of-M packs rises by about 0.4 MiB. Hidden zero-width tokens such as the
`_enter_*` markers are leaves in the tree, which likely accounts for most of the tree-size increase.

Removing the remaining duplication would change little. The JSX member suffix candidate (−86 states) shrank an
unstripped benchmark executable by 6,656 bytes and showed no parse-time difference that the measurement could
resolve.

### Conclusion

The 52 % state growth costs about 4 % parse time on clean real-world code (7 % for incremental parses under
Callgrind), 1 % to 3 % memory, and 190 KB of binary size. On inputs that v1.0.0 parsed with errors, v4.4.0 is
faster. The closed performance targets, N-of-M at or below 95 % of v1.0.0 and npm close to v1.0.0, remain unmet
as recorded in `AGENTS.md`.

## Not verified

- Candidates 1 and 2 were checked only on the 735 JavaScript corpus inputs. They were not checked on the full
  fixed input sets, on malformed JSX, on TypeScript and TSX, together, or for runtime cost. The candidate diffs are
  not committed.
- How many of the +128 states of #29 a narrower marker placement could save was not measured.
- The Windows timings come from one machine without CPU pinning. Callgrind on Linux remains the release
  criterion. The benchmark did not cover TypeScript or TSX, which vendor this grammar.
