# AGENTS.md — tree-sitter-javascript

Owner-maintained tree-sitter grammar for JavaScript, continued from `tree-sitter/tree-sitter-javascript` v0.25.0
(`44c892e`) to keep it correct and fix defects fast. Intended consumer: `go-treesitter`, which pins a commit here under
its ADR-0024 rule 7 and regenerates `src/parser.c` with tree-sitter CLI 0.27.2. The repository is independent
(`docs/decisions/ADR-0001-continue-from-upstream.md`): the origin's v0.25.0 is kept as `refs/upstream/v0.25.0`, and its
later changes are adopted deliberately, never synchronized.

## Rules

- Source is `grammar.js` and hand-written `src/scanner.c`. `src/parser.c`, `src/grammar.json` and `src/node-types.json`
  are generated: edit the grammar, run `tree-sitter generate --abi 15 --js-runtime native` with CLI 0.27.2, commit both.
- Node kinds and field names are a public contract: removing or renaming one is breaking (major version, CHANGELOG);
  adding one is not. Keep the grammar name `javascript` and the C symbol `tree_sitter_javascript`.
- A fix starts from a failing case (corpus test or oracle case) and cites its evidence. Existing corpus tests keep
  passing unless the change alters them on purpose and says why.
- Keep every copyright line in `LICENSE` and the attribution in `NOTICE` (MIT).
- Agents prepare branches, commits and pull requests. Every merge, tag, release, publication, repository-setting change
  and deletion needs the owner's approval. No registry publishing (npm, crates.io, PyPI).
