# ADR-0001: Continue from upstream v0.25.0

- Status: accepted (owner decision, 2026-11-18)
- Date: 2026-11-18

## Context

`go-treesitter` pins this grammar from the origin, `tree-sitter/tree-sitter-javascript` (commit `58404d8`), and needs
fixes faster than the origin ships them. Its ADR-0024 rule 7 (owner-maintained repositories) designates this repository
as an independent source, created without a GitHub fork relationship, with the same model as
`wotjr1649/tree-sitter-mssql`. go-treesitter still pins the origin; moving its pin here is a separate PR with its own
comparison (rule 7.5, ADR-0023 patches carried unchanged per 7.6) and the owner's approval (7.10).

The baseline is origin v0.25.0, commit `44c892e0be055ac465d5eeddae6d3e194424e7de` (tag object `f76aea6`). The commit
go-treesitter pinned before this move (`58404d8`) differs from it only in `.github/workflows/ci.yml` and `.github/workflows/lint.yml` (`Cargo.toml` and README are
identical).

## Decision

1. Continue the grammar here from origin v0.25.0 (`44c892e`), merged with its full history. The origin's tags stay out
   of `refs/tags`; v0.25.0 is kept as `refs/upstream/v0.25.0` in the owner's local clone (not pushed).
2. This repository is independent. Origin changes are adopted deliberately when useful, not synchronized, and no
   defect fix waits for the origin.
3. Own versions start at v1.0.0, which is exactly the baseline behaviour: regenerating `src/` with tree-sitter CLI
   0.27.2 (`--abi 15 --js-runtime native`) gives `src/parser.c`, `src/grammar.json`, `src/node-types.json` and the
   `src/tree_sitter` headers identical to what go-treesitter generates from the previous pin; `src/scanner.c` equals the
   origin's (go-treesitter's ADR-0023 patch to it stays in go-treesitter). Manifest versions are 1.0.0 except
   `tree-sitter.json` `metadata.version`, which the generator compiles into `parser.c` (`.metadata`) and which stays
   `0.25.0` so `src/` stays identical (owner decision; the real version is set in the first behaviour-changing release,
   v1.1 or later); nothing is tagged or published here. Later versions change behaviour only through fixes that start from a failing case.
4. No registry publishing (npm, crates.io, PyPI) and no automated tagging or release workflow. Consumers pin commits.
5. The grammar name `javascript`, the C symbol `tree_sitter_javascript`, node kinds and fields stay unless a release
   declares a breaking change (major version, CHANGELOG).
6. The parser is ABI 15 and the binding runtimes follow it: lower bounds are the 0.25 line (Rust `>=0.25, <0.28`,
   Node `^0.25.0`, Python `~=0.25`, Go go-tree-sitter v0.25.0 with Go 1.23, Swift SwiftTreeSitter 0.25.0 and
   `swift-tools-version` 5.9, the minimum SwiftTreeSitter 0.25.0 itself declares), the lockfiles use the newest release
   (Rust 0.27.2, Node 0.25.1) and `Package.resolved` pins SwiftTreeSitter 0.25.0 and tree-sitter 0.25.10. Python has no
   lockfile: CI installs it under `ci/python-constraints.txt` (`tree-sitter==0.26.1`) and checks the installed version.
   CI builds Swift with `--force-resolved-versions`, which rejects a `Package.resolved` that no longer matches the
   manifest and would need re-resolving, and compares `Package.resolved` byte for byte before and after the build and
   test (`cmp` against a copy), so the build does not rewrite it; a lockfile update that matches the manifest is
   committed with the PR and passes. It runs on Swift 6.1 (Ubuntu 24.04, macOS 15) and on the 5.9 toolchain. CMake
   defaults to ABI 15, and binding tests parse a small input so a mismatch fails. The origin's v0.25.0 Python
   requirement `tree-sitter~=0.24` allowed 0.24.0, which cannot load its ABI 15 parser, as well as 0.25.0 and 0.26.1;
   this repository's `~=0.25` excludes the 0.24 line. The origin's Go module required go-tree-sitter v0.24.0 explicitly;
   this repository requires v0.25.0. Lowering these needs the owner's approval.
7. Planned oracle for later fixes: a reference JavaScript parser (acorn or Babel, or `tsc`) judging whether a source
   is valid. It is not set up in v1.0.0.

## Consequences

- Pinned commits stay reachable because this repository does not rewrite its history.
- The origin's publish workflow, `FUNDING.yml` and the maintainers entry are removed; the release path is decided
  separately by the owner. CI runs on `main` and pull requests without path filters. Its manual trigger (`workflow_dispatch`) is declared, and the
  Actions tab offers it once the workflows are on the default branch.
- The Go module path is `github.com/wotjr1649/tree-sitter-javascript` (`go.mod` and the Go binding test import). Package
  names (npm, crate, PyPI, Swift) still carry the origin's names; the owner decides when to change them.
