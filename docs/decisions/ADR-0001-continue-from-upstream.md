# ADR-0001: Continue from upstream v0.25.0

- Status: accepted (owner decision, 2026-11-18)
- Date: 2026-11-18

## Context

`go-treesitter` pins this grammar and needs fixes faster than the origin, `tree-sitter/tree-sitter-javascript`, ships
them. Its ADR-0024 rule 7 (owner-maintained repositories) designates this repository as an independent source, created
without a GitHub fork relationship, with the same model as `wotjr1649/tree-sitter-mssql`.

The baseline is origin v0.25.0, commit `44c892e0be055ac465d5eeddae6d3e194424e7de` (tag object `f76aea6`). The commit
go-treesitter pinned before this move (`58404d8`) differs from it only in `.github/*`, `Cargo.toml` and README.

## Decision

1. Continue the grammar here from origin v0.25.0 (`44c892e`), merged with its full history. The origin's tags stay out
   of `refs/tags`; v0.25.0 is kept as `refs/upstream/v0.25.0`.
2. This repository is independent. Origin changes are adopted deliberately when useful, not synchronized, and no
   defect fix waits for the origin.
3. Own versions start at v1.0.0, which is exactly the baseline behaviour: regenerating `src/` with tree-sitter CLI
   0.27.2 (`--abi 15 --js-runtime native`) gives `src/parser.c`, `src/grammar.json` and `src/node-types.json` identical to
   what go-treesitter generates from the previous pin. Later versions change behaviour only through fixes that start
   from a failing case.
4. No registry publishing (npm, crates.io, PyPI) and no automated tagging or release workflow. Consumers pin commits.
5. The grammar name `javascript`, the C symbol `tree_sitter_javascript`, node kinds and fields stay unless a release
   declares a breaking change (major version, CHANGELOG).
6. Planned oracle for later fixes: a reference JavaScript parser (acorn or Babel, or `tsc`) judging whether a source
   is valid. It is not set up in v1.0.0.

## Consequences

- Pinned commits stay reachable because this repository does not rewrite its history.
- The origin's publish workflow is removed; the release path is decided separately by the owner.
- Binding module paths (`go.mod`, the Go binding import) and package names still carry the origin's names; the owner
  decides when to change them.
