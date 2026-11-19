# JavaScript oracle

Two independent reference parsers say what a JavaScript/JSX source is; CI replays their verdicts against this grammar through the tree-sitter API. It guards fixes: a case is registered only when the grammar already agrees with the verdict, so there is no expected-failure list. The input of a fix enters here, as a passing case, in the pull request that fixes it.

| Path | Holds |
| --- | --- |
| `package.json`, `package-lock.json` | The two tools, exact versions: `@babel/parser` 8.1.2 and `oxc-parser` 0.159.0 (`npm ci`, integrity from the lockfile). Separate from the root `package.json` |
| `cases.jsonl` | The cases, one JSON record per line |
| `run.mjs` | The verdict runner (Node, ESM) |
| `verdicts.json` | The committed verdicts, produced by `run.mjs` |
| `replay/` | The Go replay (nested module `replay/go.mod`, `github.com/tree-sitter/go-tree-sitter` v0.25.0 through cgo, the repository's `bindings/go` through a `replace`); `judge_test.go` is its self-check |

TypeScript and TSX are not covered here.

## Verdicts

Each tool classifies a case, for its `sourceType` (`module` unless the case says `script`), UTF-8 bytes, ECMAScript level at the tool's default (no proposal plugins):

| Class | Babel (`parse(src, { sourceType, plugins: ["jsx"], errorRecovery: true })`) | oxc (`parseSync("oracle.jsx", src, { lang: "jsx", sourceType, showSemanticErrors })`) |
| --- | --- | --- |
| `accept` | no error | no error with `showSemanticErrors: true` |
| `syntax` | throws | errors with `showSemanticErrors: false` |
| `early` | returns recovered errors in `ast.errors` | errors only with `showSemanticErrors: true` |

The verdict is the common class, or `disagree` when the tools differ (kept with both results, excluded from every gate until a later pull request settles it with spec or test262 evidence). Error positions in `verdicts.json` are UTF-8 byte offsets (the tools count UTF-16 units).

What the replay requires of the tree-sitter tree, per verdict:

| Verdict | Requirement |
| --- | --- |
| `accept` | The tree is faithful (below), and every `expect` entry holds. An accepted case whose tree has an error is refused: there is no way to register it |
| `syntax` | The root has an error and a problem node holds `errorAt` (below) |
| `early` | Recorded and printed, never gated: tree-sitter is not expected to catch early errors. The case needs a `reason` |
| `disagree` | Recorded and printed, never gated. The case needs a `reason` |

**Faithful tree**, judged through the API and not through the CLI summary: the root does not report `has_error`; there is no `ERROR` node, no `MISSING` node and no zero-width node (the zero-width root of an empty or whitespace-only input is not a defect, and such an input is faithful); and the leaves cover the input, that is every byte outside all leaves is white space (Unicode `White_Space`, U+FEFF, U+200B, U+2060: the gaps `grammar.js` skips).

**`expect`** (accept cases): entries `s-e:kind`; the deepest node whose range covers bytes `[s,e)` has that kind (the first one in document order among equals), as in go-treesitter's `testdata/korean/manifest.csv`. Offsets are UTF-8 bytes.

**`errorAt`** (syntax cases): the decided error position, a UTF-8 byte offset. Take it from the tools' positions in `verdicts.json` (they may differ by tool; pick the first offending token). It holds when some `ERROR` or `MISSING` node starts at or before `errorAt` and either contains it (`start <= errorAt <= end`) or ends before it with only gap characters in between (the same set as above: Unicode `White_Space`, U+FEFF, U+200B, U+2060; any number of bytes and lines, so an input that is only white space between the node and `errorAt` qualifies). The second part exists because recovery leaves the node on the last good token while the tools name the next one (`{ using a = ; }`: the `ERROR` ends at 11, the tools say 12).

## Case records

```json
{"id":"j2/optchain-delete-call","sha256":"…","source":"a?.delete(b)","sourceType":"module","expect":["3-9:property_identifier"]}
```

`id` is unique; `sha256` is the hash of the UTF-8 bytes of `source`; `sourceType` is `module` or `script`; `expect`, `errorAt` and `reason` are optional as above (`expect` only with an `accept` verdict, `errorAt` required for and only with `syntax`, `reason` required with `early` and `disagree`). Any other field is refused.

`verdicts.json` has `meta` (per tool: package, version, npm integrity and options; encoding; `cases_sha256`; the runner's own `runner_sha256`) and `results` (per case: `id`, `sha256`, `sourceType`, `verdict`, and each tool's class and errors).

## Run

```sh
(cd oracle && npm ci --ignore-scripts)
node oracle/run.mjs                      # rewrites oracle/verdicts.json; byte-identical on every run
(cd oracle/replay && go build -o ../../build/oracle-replay . && ../../build/oracle-replay -oracle ..)  # judge; add -tree to print every tree with byte ranges
(cd oracle/replay && go test .)          # self-check of the judging logic
```

`go run . -oracle ..` also judges, but it reports exit code 2 of the program as 1 (`exit status 2`): to see the real exit code, run the built binary as above (CI only needs pass or fail and uses `go run`). `build/` is git-ignored. The Go binding `#include`s `../../src/parser.c` and `scanner.c`, which the Go build cache does not track: after `src/` changes (another branch, a regenerated parser), build with a fresh `GOCACHE` or `go build -a`, or the replay judges the old grammar. CI builds without a restored cache.

`run.mjs --rehash` fills in or fixes every `sha256` and rewrites `cases.jsonl` in its canonical form. `run.mjs --cases FILE --out FILE` works on other files (scratch runs).

Exit codes of `run.mjs`: 0 verdicts written; 2 inconsistent inputs (a line that is not a JSON object, an unknown field, a bad or duplicate id, a hash that does not match, an invalid `sourceType`, an empty case set, an installed tool that differs from the pin or the lockfile), nothing written.

Exit codes of the replay:

- **0**: every gated case is consistent.
- **1**: a result differs; the differences are listed. Registering such a case is not an option (rule: no mismatch in the committed set).
- **2**: the inputs are inconsistent: a `sha256` that does not match its source, verdicts made from other cases (`cases_sha256`) or another runner (`runner_sha256`), a `meta.tools` that is not exactly the two tools `babel` (`@babel/parser`) and `oxc` (`oxc-parser`), versions or integrity that differ between `verdicts.json`, `package-lock.json` and the exact pins in `package.json`, a case whose `verdict` is not what its Babel and oxc classes give (the replay recomputes every consensus), a case that does not fit its verdict, a `cases.jsonl` line that is not exactly one JSON object (the file is read line by line to the end, so trailing bytes are an error), a `sourceType` other than `module` or `script`, an empty case set, or a grammar that cannot be loaded. Nothing is judged.

CI (`oracle` job of `.github/workflows/ci.yml`, `ubuntu-24.04`): `npm ci`, regenerate `verdicts.json` and fail on any difference from the committed file, the self-check, then the replay.

## Tree dumps for reviews and release notes

`replay -dump OUT.jsonl [-root DIR] [INPUT...]` parses inputs without judging them and writes one JSON line per input: `id`, `sha256` of the source, `error` (the root's `has_error`), the `errors` and `missing` node counts, and `tree`, every node named and anonymous as `(field:kind@start:end ...)` (anonymous kinds quoted, `MISSING ` before a missing node's kind, UTF-8 byte offsets). Inputs are glob patterns relative to `-root` (default `../..`): a `*.jsonl` file holds `{id, source}` records with a string `source` (other fields ignored, so `oracle/cases.jsonl` works as is); a `.txt` file under `corpus/` is split into its tests by the rules of tree-sitter CLI 0.27.2, so each source is the bytes the CLI parses: everything between the header and the longest `---` divider (the last one of that length) except the one line ending before it, CRLF kept; header attributes such as `:error` and suffixed `===` headers are understood. Corpus ids are `test/corpus/x.txt#name` (the name without attribute lines), numbered `#2`, `#3`... while taken; a corpus file without tests or a test without a divider is an error. Any other file is one input named by its path. Without inputs it dumps the corpus, `examples/`, `test/highlight/`, `test/tags/` and `oracle/cases.jsonl`. Ids must be unique.

`node scripts/tree-diff.mjs BASE.jsonl HEAD.jsonl [--trees]` compares two dumps by id: same, changed-clean (no ERROR or MISSING on either side), clean-to-error, error-to-clean, error-changed, only-base, only-head, as a markdown table and the list of changed ids (`--trees` adds both trees). It refuses (exit 2) a record without a valid `id`, 64-hex `sha256`, `tree`, `error`, `errors` and `missing`, and an id whose source differs between the dumps.

To compare two commits, build the dump of each against that commit's grammar and the same inputs. The binding `#include`s the commit's `src/parser.c`, so each build needs its own checkout and `go build -a` (or a fresh `GOCACHE`):

```sh
set -euo pipefail                           # a failed step, such as go build, stops the comparison
mkdir -p build && cmp=$(mktemp -d "$PWD/build/cmp.XXXXXX")  # fresh per run: no binary or dump of an earlier run
trap 'for w in "$cmp"/*/; do git worktree remove --force "$w"; done' EXIT
for rev in v1.0.0 HEAD; do
  git worktree add --detach "$cmp/$rev" "$rev"
  rm -rf "$cmp/$rev/oracle/replay"                    # this dump tool, that grammar; v1.0.0 has no oracle/
  mkdir -p "$cmp/$rev/oracle"
  cp -r oracle/replay "$cmp/$rev/oracle/replay"
  (cd "$cmp/$rev/oracle/replay" && go build -a -o "$cmp/replay-$rev" .)
  "$cmp/replay-$rev" -root . -dump "$cmp/$rev.jsonl"   # -root .: the inputs of this checkout for both
done
node scripts/tree-diff.mjs "$cmp/v1.0.0.jsonl" "$cmp/HEAD.jsonl" --trees
```

## Adding cases in a fix pull request

1. Write the failing input (corpus case or here) first. Append the record to `cases.jsonl` with the correct `sourceType`; leave `sha256` empty or wrong.
2. `node oracle/run.mjs --rehash`, then `node oracle/run.mjs`; read the verdict and the positions in `verdicts.json`. A `disagree` or `early` input is not a defect input: do not register it as one.
3. After the fix, `-tree` on the replay (`../../build/oracle-replay -oracle .. -tree` in `oracle/replay`, or `go run . -oracle .. -tree`) shows the trees. For an `accept` case add `expect` entries for the nodes the fix is about; for a `syntax` case add `errorAt`.
4. `node oracle/run.mjs` again, then the replay must exit 0. Commit `cases.jsonl` and `verdicts.json` together.

Changing a tool version means changing `package.json` and `package-lock.json` and regenerating `verdicts.json` in the same pull request; review every verdict that moves.
