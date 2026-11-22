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

## Not verified

- Candidates 1 and 2 were checked only on the 735 JavaScript corpus inputs. They were not checked on the full
  fixed input sets, on malformed JSX, on TypeScript and TSX, together, or for runtime cost. The candidate diffs are
  not committed.
- How many of the +128 states of #29 a narrower marker placement could save was not measured.
