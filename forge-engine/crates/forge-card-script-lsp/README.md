# forge-card-script-lsp

A [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) server for the
**Forge card-script DSL** (Magic: The Gathering card definitions). It is built on
[`forge-card-script`](https://crates.io/crates/forge-card-script) and is part of the
[ManaBrew](https://github.com/witchesofthehill/manabrew) project.

## Features

- **Diagnostics** — missing `:` / `$` delimiters, empty keys, missing ability record type,
  missing SVar name, and duplicate parameters (last-wins), published as you type.
- **Hover** — over a parameter shows its inferred semantic type and raw value; over an SVar
  reference shows the SVar's definition (or a warning if it is not defined on the card).
- **Go to definition** — from an SVar reference (`Execute$`, `SubAbility$`, …) to its `SVar:` line.

Positions are reported in UTF-16 code units per the LSP spec, so ranges stay correct for cards
with non-ASCII text (accented names, em-dashes in oracle text).

## Build & run

```bash
cargo build --release -p forge-card-script-lsp
# binary: target/release/forge-card-script-lsp  (speaks LSP over stdio)
```

### Neovim example

```lua
vim.lsp.start({
  name = "forge-card-script",
  cmd = { "forge-card-script-lsp" },
  root_dir = vim.fn.getcwd(),
})
```

Pair it with the [`tree-sitter-forge-card-script`](https://crates.io/crates/tree-sitter-forge-card-script)
grammar for syntax highlighting.

## Scope

This is a focused server: diagnostics, hover, and SVar go-to-definition. There is no completion,
document-symbol, or semantic-tokens support yet.

## License

GPL-3.0-or-later. See the repository for details.
