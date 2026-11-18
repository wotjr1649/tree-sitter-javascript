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

**Faithful tree**, judged through the API and not through the CLI summary: the root does not report `has_error`; there is no `ERROR` node, no `MISSING` node and no zero-width node (other than the root of an empty input); and the leaves cover the input, that is every byte outside all leaves is white space (Unicode `White_Space`, U+FEFF, U+200B, U+2060: the gaps `grammar.js` skips).

**`expect`** (accept cases): entries `s-e:kind`; the deepest node whose range covers bytes `[s,e)` has that kind (the first one in document order among equals), as in go-treesitter's `testdata/korean/manifest.csv`. Offsets are UTF-8 bytes.

**`errorAt`** (syntax cases): the decided error position, a UTF-8 byte offset. Take it from the tools' positions in `verdicts.json` (they may differ by tool; pick the first offending token). It holds when some `ERROR` or `MISSING` node starts at or before `errorAt` and either contains it (`start <= errorAt <= end`) or ends before it with only white space in between. The second part exists because recovery leaves the node on the last good token while the tools name the next one (`{ using a = ; }`: the `ERROR` ends at 11, the tools say 12).

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
(cd oracle/replay && go run . -oracle ..)  # judge; add -tree to print every tree with byte ranges
(cd oracle/replay && go test .)          # self-check of the judging logic
```

`run.mjs --rehash` fills in or fixes every `sha256` and rewrites `cases.jsonl` in its canonical form. `run.mjs --cases FILE --out FILE` works on other files (scratch runs).

Exit codes of `run.mjs`: 0 verdicts written; 2 inconsistent inputs (bad record, id or hash, installed tool differs from the pin or the lockfile), nothing written.

Exit codes of the replay:

- **0**: every gated case is consistent.
- **1**: a result differs; the differences are listed. Registering such a case is not an option (rule: no mismatch in the committed set).
- **2**: the inputs are inconsistent: a `sha256` that does not match its source, verdicts made from other cases (`cases_sha256`) or another runner (`runner_sha256`), tool versions or integrity that differ from `package-lock.json` or from the exact pins in `package.json`, a case that does not fit its verdict, or a grammar that cannot be loaded. Nothing is judged.

CI (`oracle` job of `.github/workflows/ci.yml`, `ubuntu-24.04`): `npm ci`, regenerate `verdicts.json` and fail on any difference from the committed file, the self-check, then the replay.

## Adding cases in a fix pull request

1. Write the failing input (corpus case or here) first. Append the record to `cases.jsonl` with the correct `sourceType`; leave `sha256` empty or wrong.
2. `node oracle/run.mjs --rehash`, then `node oracle/run.mjs`; read the verdict and the positions in `verdicts.json`. A `disagree` or `early` input is not a defect input: do not register it as one.
3. After the fix, `go run . -oracle .. -tree` in `oracle/replay` shows the trees. For an `accept` case add `expect` entries for the nodes the fix is about; for a `syntax` case add `errorAt`.
4. `node oracle/run.mjs` again, then the replay must exit 0. Commit `cases.jsonl` and `verdicts.json` together.

Changing a tool version means changing `package.json` and `package-lock.json` and regenerating `verdicts.json` in the same pull request; review every verdict that moves.
