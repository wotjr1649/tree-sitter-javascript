# tree-sitter-javascript

[![CI][ci]](https://github.com/wotjr1649/tree-sitter-javascript/actions/workflows/ci.yml)
[![discord][discord]](https://discord.gg/w7nTvsVJhm)
[![matrix][matrix]](https://matrix.to/#/#tree-sitter-chat:matrix.org)

JavaScript and JSX grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter).

This repository is an owner-maintained continuation of
[tree-sitter/tree-sitter-javascript](https://github.com/tree-sitter/tree-sitter-javascript) from v0.25.0
([ADR-0001](docs/decisions/ADR-0001-continue-from-upstream.md)). It publishes no packages to npm, crates.io or PyPI;
consumers pin a commit of this repository.

This grammar intends to be a close approximation of the [ECMAScript](https://ecma-international.org/publications-and-standards/standards/ecma-262/)
specification, with some extensions to support JSX syntax. We try to support the
latest version of the spec, though it is possible that some very new features may
not be supported yet.

References

- [The ESTree Spec](https://github.com/estree/estree)
- [The ECMAScript 2025 Spec](https://tc39.es/ecma262/2025/)

## Known limitations

After widening an included range or adding a new one, parse from scratch with the updated ranges. In the C API,
set the ranges with `ts_parser_set_included_ranges` and pass `NULL` as `old_tree`. Reusing the old tree can keep
tokens that ended at a previous included-range boundary.

[ci]: https://img.shields.io/github/actions/workflow/status/wotjr1649/tree-sitter-javascript/ci.yml?logo=github&label=CI
[discord]: https://img.shields.io/discord/1063097320771698699?logo=discord&label=discord
[matrix]: https://img.shields.io/matrix/tree-sitter-chat%3Amatrix.org?logo=matrix&label=matrix
