# Defect discovery

Finds the places where this grammar fails on valid JavaScript/JSX, at scale. Local outputs default to `build/discovery/`
(git-ignored). The on-demand cross-platform CST comparison uses the fetch and collect steps. The committed oracle
(`../README.md`) guards fixes. Early errors are counted separately.

Inputs (pinned in `manifest.json`):

| Set | What | Truth |
| --- | --- | --- |
| `test262` | `test/language`, `test/built-ins`, `test/annexB` of `tc39/test262` at the pinned commit. `staging/` and `intl402/` are skipped, and so is every test whose `features:` lists a feature that `features.txt` keeps above `## Standard language features` (stage 3 and earlier), and every fixture that uses `import defer`/`import source` | The metadata: `negative: {phase: parse}` must be rejected, anything else must parse. `flags: [module]` gives the source type, `onlyStrict` prepends `"use strict";\n`, `*_FIXTURE.js` are modules judged by the tools. A plain script test is judged **in sloppy mode only**: test262's runner also runs it in strict mode (INTERPRETING.md), this tool does not, so a script that is valid only sloppy (or only strict) is read as the metadata says for the one mode tried |
| `npm` | JS/JSX/MJS/CJS files of the packages in `manifest.json`, pinned by version and tarball sha256/sha512 (`.mjs` module, `.cjs` script, `.js` tried as script and as module; a package may limit itself with `include`) | The tools: a file is valid when both accept it for some source type |
| `babel-jsx` | `input.*` files of `packages/babel-parser/test/fixtures/jsx` of `babel/babel` at the pinned commit (JSX has no test262) | The tools (Babel is one of them, so only agreement counts). The fixtures' `options.json` is not read: each input is tried as module and as script and the first type both tools accept decides, so this set finds inputs on which the tools agree in some context, not the fixture's own verdict (`errors/html-comment-module` is a valid script and an invalid module) |

Babel 8.1.2 and oxc 0.159.0 answer with the exact options of `../run.mjs` (JSX on, `errorRecovery`, `showSemanticErrors`).
Their classes are `accept` (no error), `early` (Babel: recovered errors only; oxc: errors only with `showSemanticErrors`) and
`syntax` (a parse error). This grammar is run through the Go binding of the repository by `tsparse`, with the faithfulness
rule of `../replay` (no ERROR, MISSING or zero-width node, leaves cover the input); the rule is copied (`scan` and `isGap`
in `tsparse/main.go` follow `flatten`/`analyze`/`isGap` of `../replay/judge.go`), not shared, because `../replay` is a `main`
package. To share it, move that judgement into a package that is not `main` and import it from both, as its own change after
PR #27 (`oracle/replay -dump`: trees with fields and byte ranges for any `{id, source}` JSONL) has merged, since #27 edits
`replay/main.go`. `structure.mjs` could then read `-dump` output instead of `tsparse -serve`'s node list.

## Categories

| Cat | Meaning |
| --- | --- |
| A1 | valid input (test262 positive, or both tools accept), tree-sitter tree not clean, both tools accept: a **defect**, reducible |
| A2 | test262 positive, tree-sitter tree not clean, but a tool rejects it: a probable defect, not reducible (no validity oracle) |
| B1 | invalid input that both tools reject as a syntax error (Babel throws, oxc fails without semantic errors), tree-sitter reports **no error** (no ERROR or MISSING node; zero-width and uncovered input are not checked for B): a **grammar error** missed |
| B2 | invalid input, both tools say early error only, tree-sitter reports no error: out of scope (early errors) |
| B3 | invalid input, tree-sitter reports no error, and the tools disagree or both accept: the oracle cannot say. In practice Babel-recoverable errors that oxc reports as syntax (early errors, 1527 of 1882) and regular-expression pattern errors that neither reports |
| C | no truth and the tools disagree |
| T | a parse hit the 60 s limit (none so far) |
| X | the input could not be read, or its sha256 is not the one `collect.mjs` recorded (a changed checkout): no verdict, never a defect; `tsparse` and `analyze.mjs` exit with 3 |

Only ERROR/MISSING, zero-width and uncovered-input defects are found. A wrong tree without an error (for example
`()=>{}\n(1)`, `if (x) { a: 1 }` parsed as an object) is invisible to this run: the structure run below finds those.

## Run

```sh
(cd oracle && npm ci --ignore-scripts)              # the parser tools (Babel, oxc) only: the discovery inputs are never installed
node oracle/discover/fetch.mjs                      # clones (core.autocrlf=false) and npm packs into build/discovery/data; --pin rewrites the hashes, otherwise a mismatch is an error
(cd oracle/discover/tsparse && go build -o ../../../build/discovery/tsparse.exe .)   # use a fresh GOCACHE after src/ changes (see ../README.md)
node oracle/discover/collect.mjs                    # oracle.jsonl: Babel and oxc verdicts per input
build/discovery/tsparse.exe -in build/discovery/oracle.jsonl -data build/discovery/data -out build/discovery/ts.jsonl
node oracle/discover/analyze.mjs                    # results.jsonl, defects.jsonl (A1), rejects.jsonl (B1), summary.json
node oracle/discover/minimize.mjs                   # min.jsonl: one short valid reproducer per A1 input
node oracle/discover/minimize.mjs --mode reject     # min-reject.jsonl: one short grammar error per B1 input that tree-sitter accepts
node oracle/discover/cluster.mjs                    # clusters.json, clusters.md, by the rules in cluster-rules.json
node oracle/discover/stats.mjs                      # stats.json: counts per set, test262 root, npm package
```

`probe.mjs FILE` checks short sources (one JSON string per line) against both tools and the grammar, `--tree` prints the
tree, `--type module` switches the source type: use it to confirm and generalise a reproducer.

The runs are heavy jobs on the shared machine (`RESOURCES.md`): take a slot, at most 3 threads (`tsparse -workers` is
capped at 3; `minimize.mjs` is one Node thread plus one `tsparse -serve` child). Downloaded code is data: it is parsed,
never executed, and `fetch.mjs` runs `npm pack --ignore-scripts` and `tar -x` only. The whole pipeline after the fetch takes
about 3 minutes (collect 95 s, tsparse 60 s, both minimisations 10 s).

Pinned bytes. `fetch.mjs` stops before using a tarball whose sha256 or sha512 differs from the manifest (nothing is extracted,
a stale extraction is removed, and a verified tarball is always extracted afresh, never reused). The git checkouts are made with
`core.autocrlf=false`, and `fetch.mjs` and `collect.mjs` check that every file under the pinned paths is byte for byte the blob of
the pinned commit (`git hash-object --no-filters`) and that no other file is on disk under those paths (untracked, ignored or
only staged; `collect.mjs` walks the disk); a checkout with CRLF files or an extra file is an error, not a run (exit 2 with the
first paths; delete it and fetch again).
`collect.mjs` records the sha256 of each file it judged, and every later stage that reads the file again (`tsparse`,
`structure.mjs`, `minimize.mjs`, `structure-min.mjs`, and `stats.mjs` for the npm `jsxLike` count) refuses a file whose bytes
differ or that cannot be read: it is category `X` / status `input-error` (in `stats.json`: `inputErrors`, not counted), exit
code 3, and is never counted as a parser defect.

`tools.mjs` repeats the options, error classes and UTF-16 to UTF-8 conversion of `../run.mjs` instead of importing them,
because `run.mjs` is a script whose sha256 is recorded in `../verdicts.json`. `test/pinned.test.mjs` runs `run.mjs` on a few cases
and fails when the two disagree. Plan: when `run.mjs` is next changed for another reason, move the shared functions into a module
both import.

## Structure run: wrong trees without an error

The run above counts only ERROR/MISSING. The structure run takes the valid inputs whose tree is clean (`results.jsonl`: test262
positives, and the other sets' inputs both tools accept) and compares ranges with Babel's AST (`createParenthesizedExpressions`,
no `errorRecovery`; an input Babel rejects is counted, not compared). Both sides are reduced to items `{family, start, end}`
(`structure-lib.mjs`): statements and declarations (`S:`), expressions (`E:`: call, member, assign, binary, arrow, object,
array, template, paren, ...), identifiers and literals (`L:`), patterns (`P:`) and members (`M:`). A mismatch is an item one side
has at a range where the other has none of that family (`B`: only Babel, `T`: only the grammar); a statement-count difference
of a program, block or switch case is reported as well. The grammar's side uses `src/node-types.json` (a test checks that every
kind of the `statement`, `declaration`, `expression` and `pattern` supertypes has a family). The normalisations for known
representation differences (parentheses of `if (...)`, `for` headers, trailing comments and `;`, UTF-16 to UTF-8 offsets, ...)
are listed at the top of `structure-lib.mjs`, and their counts go into the run's summary. Statement counts are taken per owner
(program, block, static block, switch case) on both sides from the owner's own trimmed range, and an owner starts at 0 when it is
met, so an owner whose statements are missing on one side is reported.

Three of the normalisations are design differences the owner approved, not defects: the parenthesized head of `if`/`while`/`do`/
`switch`/`with` (a `parenthesized_expression` here, nothing in Babel); the declaration of `for (var x of y)` and `for (x in y)`
folded into the `for_in_statement` (Babel's `VariableDeclaration` and its declarators are dropped); and an anonymous
`export default function(){}` / `class{}` read as an expression (a `function_expression`/`class`, not a declaration). Detection
limits that follow: a wrong `kind` field of a folded `for…in/of` declaration is invisible while the binding ranges agree; the
comparison is by range and coarse family, so an expression where a pattern belongs (the family `E:obj` covers both), the kind of an
identifier (all of `L:id`), or two nodes of the same family at one range are not told apart; and the run sees only what Babel sees
(an input Babel rejects is not compared). That the run found its mismatches says nothing about further causes hiding behind these
limits.

```sh
(cd oracle/discover/tsparse && go build -o ../../../build/structure/tsparse.exe .)   # the dump mode needs this build
node oracle/discover/structure.mjs                  # build/structure/structure.jsonl (+ .summary.json): one line per input with a mismatch
node oracle/discover/structure.mjs --corpus test/corpus --out build/structure/corpus.jsonl   # the corpus inputs both tools accept
node oracle/discover/structure.mjs --out build/structure/examples.jsonl --files examples/jquery.js   # plain files (put --files last)
node oracle/discover/structure-min.mjs              # min-structure.jsonl: one short valid reproducer per mismatching input
node oracle/discover/cluster.mjs --dir build/structure   # clusters.json / clusters.md, rules in cluster-rules.json ("structure")
node --test oracle/discover/test/                   # unit tests: classification, minimiser predicates, reduction, structure comparison
```

`structure.mjs` runs at most 3 workers (`--workers` 1, 2 or 3, default 3; each is a Node thread with its own `tsparse -serve`
child) and skips inputs above 4 MiB (`--max-bytes`, a positive integer; applied to `--results`, `--corpus` and `--files` alike).
Every input path compares only trees that are clean (no ERROR/MISSING, no zero-width node, leaves cover the input): a tree that is
not is counted as `not-clean` and not compared, so `--corpus` and `--files` follow the same rule as `--results`. It is a heavy job
like the others (take a slot).

## Outputs (`build/discovery/`)

| File | Holds |
| --- | --- |
| `oracle.jsonl` | one record per input: `id` (path under `data/`), `set`, `pkg`, `size`, `sha256`, `truth`, test262 `flags`/`features`/`negative`, `type`, `prefix`, and per source type the Babel (`b`) and oxc (`o`) class `c`, first error position `at` (UTF-8 bytes of the file) and message `m`; or `skip` with the reason |
| `ts.jsonl` | one record per non-skipped input: `clean`, `err`, `errors`/`missing`/`zero`/`uncov`, the first problem node (`kind`, `start`, `end`, `row`, `col`, `parent`, `txt`), `us`; or `bad` (`read-error`, `hash-mismatch`) when the file is not the collected one |
| `results.jsonl` | the join: `sha256`, decisive source type, `truth`, category `cat`, both tools' class, position and message, the tree-sitter result. This is the full per-input result |
| `min.jsonl`, `min-reject.jsonl` | the minimal reproducers (`min`, text), with predicate calls and time |
| `clusters.json`, `clusters.md` | the cluster table; `stats.json` the counts |

Offsets are UTF-8 bytes of the file, rows and columns are 0-based. Reduction keeps every reproducer valid (A1: both tools
accept) or invalid (B1: both tools still reject), and keeps the original input's cause as far as the predicates can tell it
(`predicate.mjs`):

| Mode | A reduction must keep |
| --- | --- |
| A1 | the tree not clean, with the same first problem node: its kind and its parent's kind (`ERROR` under `program`, `MISSING ";"` under `expression_statement`, ...) |
| B1 | no tree error, and both Babel's and oxc's messages unchanged (names and Babel's `(line:column)` ignored) and the same class of token at oxc's error position (`id`, `num`, a keyword, operator or punctuation as it is: `=>` is not `=`) |
| structure | the same side, family, kind and parent kind of one mismatch |

A reduction can still drift to a different defect that has the same cause by these measures (the predicates are as good as the
messages and kinds they compare; before the parent kind was part of the structure cause, `[a=yield]` and `for(using of of[0]){}` both counted as `B:L:id:Identifier`). Therefore
**the cluster counts are per original input**, and a cluster is a **candidate cause**, not a confirmed one: the count says how many
inputs reduced to a reproducer of that shape, not how many distinct defects there are. Before a count is used to rank work, check
the originals against their reproducers (the `examples` of a cluster are a start). `clusters.md` says so in its first line.
