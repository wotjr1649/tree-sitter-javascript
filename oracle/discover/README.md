# Defect discovery

Finds the places where this grammar fails on valid JavaScript/JSX, at scale. It is a tool, not a gate: nothing here runs in
CI, and every output goes under `build/discovery/` (git-ignored). The committed oracle (`../README.md`) guards fixes; this
looks for new ones. Early errors are out of scope: they are counted only to be set apart.

Inputs (pinned in `manifest.json`):

| Set | What | Truth |
| --- | --- | --- |
| `test262` | `test/language`, `test/built-ins`, `test/annexB` of `tc39/test262` at the pinned commit. `staging/` and `intl402/` are skipped, and so is every test whose `features:` lists a feature that `features.txt` keeps above `## Standard language features` (stage 3 and earlier), and every fixture that uses `import defer`/`import source` | The metadata: `negative: {phase: parse}` must be rejected, anything else must parse. `flags: [module]` gives the source type, `onlyStrict` prepends `"use strict";\n`, `*_FIXTURE.js` are modules judged by the tools |
| `npm` | JS/JSX/MJS/CJS files of the packages in `manifest.json`, pinned by version and tarball sha256/sha512 (`.mjs` module, `.cjs` script, `.js` tried as script and as module; a package may limit itself with `include`) | The tools: a file is valid when both accept it for some source type |
| `babel-jsx` | `input.*` files of `packages/babel-parser/test/fixtures/jsx` of `babel/babel` at the pinned commit (JSX has no test262) | The tools (Babel is one of them, so only agreement counts) |

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
| B1 | invalid input that both tools reject as a syntax error (Babel throws, oxc fails without semantic errors), tree-sitter clean: a **grammar error** missed |
| B2 | invalid input, both tools say early error only: out of scope (early errors) |
| B3 | invalid input, the tools disagree or both accept: the oracle cannot say. In practice Babel-recoverable errors that oxc reports as syntax (early errors, 1527 of 1882) and regular-expression pattern errors that neither reports |
| C | no truth and the tools disagree |
| T | a parse hit the 60 s limit (none so far) |

Only ERROR/MISSING, zero-width and uncovered-input defects are found. A wrong tree without an error (for example
`()=>{}\n(1)`, `if (x) { a: 1 }` parsed as an object) is invisible to this run: the structure run below finds those.

## Run

```sh
(cd oracle && npm ci --ignore-scripts)
node oracle/discover/fetch.mjs                      # clones and npm packs into build/discovery/data; --pin rewrites the hashes, otherwise a mismatch is an error
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
are listed at the top of `structure-lib.mjs`, and their counts go into the run's summary.

```sh
(cd oracle/discover/tsparse && go build -o ../../../build/structure/tsparse.exe .)   # the dump mode needs this build
node oracle/discover/structure.mjs                  # build/structure/structure.jsonl (+ .summary.json): one line per input with a mismatch
node oracle/discover/structure.mjs --corpus test/corpus --out build/structure/corpus.jsonl   # the corpus inputs both tools accept
node oracle/discover/structure.mjs --out build/structure/examples.jsonl --files examples/jquery.js   # plain files (put --files last)
node oracle/discover/structure-min.mjs              # min-structure.jsonl: one short valid reproducer per mismatching input
node oracle/discover/cluster.mjs --dir build/structure   # clusters.json / clusters.md, rules in cluster-rules.json ("structure")
node --test oracle/discover/test/                   # unit tests: classification, minimiser predicates, reduction, structure comparison
```

`structure.mjs` runs at most 3 workers (`--workers`, default 3; each is a Node thread with its own `tsparse -serve` child) and
skips files above 4 MiB (`--max-bytes`). It is a heavy job like the others (take a slot).

## Outputs (`build/discovery/`)

| File | Holds |
| --- | --- |
| `oracle.jsonl` | one record per input: `id` (path under `data/`), `set`, `pkg`, `size`, `sha256`, `truth`, test262 `flags`/`features`/`negative`, `type`, `prefix`, and per source type the Babel (`b`) and oxc (`o`) class `c`, first error position `at` (UTF-8 bytes of the file) and message `m`; or `skip` with the reason |
| `ts.jsonl` | one record per non-skipped input: `clean`, `err`, `errors`/`missing`/`zero`/`uncov`, the first problem node (`kind`, `start`, `end`, `row`, `col`, `parent`, `txt`), `us` |
| `results.jsonl` | the join: decisive source type, `truth`, category `cat`, both tools' class, position and message, the tree-sitter result. This is the full per-input result |
| `min.jsonl`, `min-reject.jsonl` | the minimal reproducers (`min`, text), with predicate calls and time |
| `clusters.json`, `clusters.md` | the cluster table; `stats.json` the counts |

Offsets are UTF-8 bytes of the file, rows and columns are 0-based. Reduction keeps every reproducer valid (A1: both tools
accept) or invalid for the same reason (B1: both tools still reject and oxc's message is unchanged, names ignored); a reduction
can still drift to a different defect of the same kind, which is why the clusters are counted per input.
