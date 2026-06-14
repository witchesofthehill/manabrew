# tree-sitter-forge-card-script

A [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for the **Forge card-script
DSL** — the text format used to describe Magic: The Gathering cards in the
[Forge](https://github.com/Card-Forge/forge) rules engine. Part of the
[ManaBrew](https://github.com/witchesofthehill/manabrew) project.

It parses the line-oriented card format: field lines (`Name:`, `ManaCost:`, …), ability/trigger/
static/replacement lines (`A:`, `T:`, `S:`, `R:`), `SVar:` definitions, keyword (`K:`) lines,
`$`-delimited parameter records, comments, and multi-face cards (`ALTERNATE`, `SPECIALIZE`,
`AlternateMode`).

## Usage

The grammar is authored in `grammar.ts` (TypeScript DSL). Regenerate and test with the
[tree-sitter CLI](https://github.com/tree-sitter/tree-sitter):

```bash
yarn install
yarn generate      # tree-sitter generate
yarn test          # runs the corpus tests under test/corpus/
yarn parse <file>  # parse a card script and print its tree
```

Syntax-highlighting queries live in `queries/highlights.scm`.

### Rust binding

```toml
[dependencies]
tree-sitter = "0.24"
tree-sitter-forge-card-script = "0.1"
```

```rust
let mut parser = tree_sitter::Parser::new();
parser.set_language(&tree_sitter_forge_card_script::language()).unwrap();
let tree = parser.parse("Name:Grizzly Bears\nPT:2/2\n", None).unwrap();
```

## Coverage note

The grammar recognises the common Forge field keys explicitly; an unrecognised `Key:` line will
produce an error node. The companion [`forge-card-script`](https://crates.io/crates/forge-card-script)
crate is more permissive and degrades unknown fields gracefully, so the two can disagree on
unusual input.

## License

MIT. See [LICENSE](./LICENSE).
