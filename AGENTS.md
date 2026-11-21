# AGENTS.md — tree-sitter-javascript

Owner-maintained JavaScript grammar continued independently from `tree-sitter/tree-sitter-javascript`. See
`docs/decisions/ADR-0001-continue-from-upstream.md` for the baseline. Keep its upstream ref local and upstream tag
fetching disabled. Adopt upstream changes deliberately.

`go-treesitter` records its grammar commit and CLI pins in `tools/gen/pins.json`. Propose this repository's latest
release tag in a separate PR under go-treesitter ADR-0024, with a comparison against its current pin and owner
approval. go-treesitter regenerates `src/parser.c` with its own pinned CLI.

## Rules

- Source is `grammar.js` and hand-written `src/scanner.c`. `src/parser.c`, `src/grammar.json`, `src/node-types.json`
  and `src/tree_sitter/*.h` are generated. Run the `Verify generated sources` step's generate command in
  `.github/workflows/ci.yml` using the pinned CLI. Commit generated files with the source change. Never edit
  generated files by hand or by post-processing.
- The CLI pin is `devDependencies.tree-sitter-cli` in `package.json`. Find the latest stable release with
  `gh release view -R tree-sitter/tree-sitter`. Move the pin in its own PR. Regenerate, compare full CSTs on the
  fixed inputs, and record generated-code differences. Use a patch release for identical trees and the SemVer rules
  below for changed trees.
- `src/scanner.c` carries the JSX bare-ampersand fix from origin PR #388. ASCII-only digit checks and #63's shared
  character-reference scan followed. go-treesitter retires its ADR-0023 patch only in an approved pin move to a
  release containing the fix (its ADR-0024).
- Releases are `vMAJOR.MINOR.PATCH` annotated tags with a GitHub Release without binaries. Find the latest tag with
  `gh release view -R wotjr1649/tree-sitter-javascript`. Record every release in `CHANGELOG.md` (Keep a Changelog).
  Batch breaking changes into one major release.
  - MAJOR covers removal or renaming of a node kind, field or supertype subtype, or a CST change for valid input
    that the previous release parsed without errors. Add a CHANGELOG entry and migration notes. Valid input is
    accepted by both `@babel/parser` and `oxc-parser` as pinned in `oracle/`.
  - MINOR covers additions, error-to-ok fixes, accepted invalid input becoming an error, changes to recovery CSTs
    for inputs with errors in both versions (`ERROR` and `MISSING` included), and tree-identical performance work.
    Record all minor changes in the CHANGELOG.
  - PATCH covers build, tooling and documentation changes and CLI regeneration with identical trees.
- The release PR updates the release version in all manifests and their own lockfile entries, including
  `tree-sitter.json` `metadata.version`, then regenerates `src/` because `src/parser.c` embeds that version.
  Leave release versions unchanged in fix PRs.
- The grammar checks syntax, not early errors (static semantics, e.g. a `using` declaration without an initializer,
  `for (using x;;);`); those are a non-goal and stay accepted (owner decision, 2026-11-19). Grammar restrictions such
  as `for (using x in o);` or `await using` in a non-async function are defects, not early errors (#26).
- The generate command and CMake default read the ABI from `ci/tree-sitter-abi.txt`. Binding runtime lower bounds
  are in the binding manifests. Changing the ABI or a runtime lower bound requires owner approval and a major release.
  CI tests Python under `ci/python-constraints.txt` and Swift with `--force-resolved-versions`. Every binding test
  sets the language on a parser and parses a small input.
- Keep the grammar name `javascript` and the C symbol `tree_sitter_javascript`.
- A fix starts from a failing case (corpus test or oracle case) and cites its evidence. Existing corpus tests keep
  passing unless the change alters them on purpose and says why.
- Keep every copyright line in `LICENSE` and the attribution in `NOTICE` (MIT).
- Agents prepare branches, commits and pull requests. Every merge, tag, release, publication, repository-setting change
  and deletion needs the owner's separate approval. No registry publishing (npm, crates.io, PyPI).
