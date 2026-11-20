# AGENTS.md — tree-sitter-javascript

Owner-maintained tree-sitter grammar for JavaScript, continued from `tree-sitter/tree-sitter-javascript` v0.25.0
(`44c892e`) to keep it correct and fix defects fast. Intended consumer: `go-treesitter`. It still pins the origin
(`58404d8`) today; it would pin a commit here only through its own separately approved pin-move PR under its ADR-0024
rule 7 (the 7.5 comparison against the old pin, owner approval per 7.10), then regenerating `src/parser.c` with
tree-sitter CLI 0.27.2. The repository is independent (`docs/decisions/ADR-0001-continue-from-upstream.md`): the
origin's v0.25.0 is commit `44c892e` in this history, kept as `refs/upstream/v0.25.0` in the owner's local clone only
(not pushed; `remote.upstream.tagopt` is `--no-tags`), and its later changes are adopted deliberately, never synchronized.

## Rules

- Source is `grammar.js` and hand-written `src/scanner.c`. `src/parser.c`, `src/grammar.json`, `src/node-types.json`
  and `src/tree_sitter/*.h` are generated: edit the grammar, run `tree-sitter generate --abi 15 --js-runtime native`
  with CLI 0.27.2, commit all of them. `src/scanner.c` carries the JSX bare-ampersand fix (origin PR #388's scanner
  hunks, identical to go-treesitter's ADR-0023 patch record 0001; ADR-0001 amendment 2026-11-19) and, on top of it,
  ASCII-only digit checks for character references (J1b), so it no longer equals that record's result; v1.0.0 kept the
  origin's scanner and left that patch in go-treesitter, which retires it only in a later, separately approved pin move
  to a release containing the fix (its ADR-0024 7.6).
- Manifests, their lockfiles' own entries and `tree-sitter.json` `metadata.version` carry the release version (3.1.0
  now); CLI 0.27.2 compiles `metadata.version` into `parser.c` (`.metadata`), so regenerate `src/` after changing it.
- Releases are `vMAJOR.MINOR.PATCH` (first independent `v2.0.0` after the `v1.0.0` baseline), each an annotated tag plus
  a GitHub Release without binaries (ADR-0001 amendment 2026-11-19). SemVer: breaking (major) means a node kind, field
  or supertype subtype removed or renamed, or a changed tree for valid input (input that `@babel/parser` and
  `oxc-parser`, as pinned in `oracle/`, both accept) that the previous release parsed without an error. Minor: accepted
  invalid input that becomes an error, input that gave an error and parses now, and any change to the tree of input that
  is an error before and after (recovery trees, `ERROR` and `MISSING` nodes included); the CHANGELOG lists them all.
  Major changes are batched into one major release.
- The grammar checks syntax, not early errors (static semantics, e.g. a `using` declaration without an initializer,
  `for (using x;;);`); those are a non-goal and stay accepted (owner decision, 2026-11-19). Grammar restrictions such
  as `for (using x in o);` or `await using` in a non-async function are defects, not early errors (#26).
- The parser is ABI 15. Binding runtime lower bounds are the 0.25 line (Rust, Node, Python, Go, Swift) and CMake
  defaults to ABI 15; do not lower them without the owner's approval. `Package.swift` declares `swift-tools-version`
  5.9, the minimum SwiftTreeSitter 0.25.0 requires. CI tests Python under `ci/python-constraints.txt` and Swift with
  `--force-resolved-versions`. Every binding test sets the language on a parser
  and parses a small input.
- Node kinds and field names are a public contract: removing or renaming one is breaking (major version, CHANGELOG);
  adding one is not. `CHANGELOG.md` records every release (Keep a Changelog). Keep the
  grammar name `javascript` and the C symbol `tree_sitter_javascript`.
- A fix starts from a failing case (corpus test or oracle case) and cites its evidence. Existing corpus tests keep
  passing unless the change alters them on purpose and says why.
- Keep every copyright line in `LICENSE` and the attribution in `NOTICE` (MIT).
- Agents prepare branches, commits and pull requests. Every merge, tag, release, publication, repository-setting change
  and deletion needs the owner's separate approval. No registry publishing (npm, crates.io, PyPI).
