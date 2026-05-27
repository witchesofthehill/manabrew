# Third-Party Notices

This project incorporates and derives from third-party software. The notices
below identify each component, its origin, its license, and the form in which
this project uses it.

## Forge (Card-Forge/forge)

- **Origin:** https://github.com/Card-Forge/forge
- **License:** GNU General Public License, version 3 or later (GPL-3.0-or-later)
- **Upstream license file:** `forge/LICENSE` (vendored copy)

### Use in this project

1. **Source submodule.** The `forge/` directory at the repository root is a git
   submodule tracking our fork [witchesofthehill/forge](https://github.com/witchesofthehill/forge)
   (forked from Card-Forge/forge). Its contents are upstream Forge code,
   unmodified or with a small set of project-local patches carried on the
   `manabrew` branch of that fork. As a derivative of GPL-3.0-or-later Forge,
   the fork is itself GPL-3.0-or-later.

2. **Custom harness.** `forge-harness/` (at the repository root) is a
   project-local Java module that does **not** exist upstream. It imports and
   orchestrates classes from upstream Forge to expose a JSON adapter consumed by
   the Tauri Java backend. As an aggregate that imports GPL-3.0-or-later Forge
   classes, the harness is itself GPL-3.0-or-later.

3. **Card data.** The Tauri desktop bundle and the web bundle include card
   script files (`forge/forge-gui/res/cardsfolder/`), token scripts
   (`tokenscripts/`), and edition metadata (`editions/`) sourced from upstream
   Forge. These data files are GPL-3.0-or-later.

4. **Rust engine derivation.** The Rust rules engine
   (`forge-engine/crates/forge-engine/` and adjacent crates) is a port of the
   Java rules engine in `forge/forge-game/`. The port maintains file-level
   and interface-level parity with the Java source per the project's
   contribution conventions. The Rust engine is therefore a derivative work
   of upstream Forge and is licensed GPL-3.0-or-later.

5. **Card script DSL.** `forge-engine/crates/forge-card-script/` and
   `forge-engine/crates/forge-carddb/` parse and execute Forge's card-script
   text format. `docs/forge-dsl-grammar.md` and `docs/forge-dsl-semantics.md`
   describe Forge's existing format; they are not an independent specification.

### Forge license notice

> Forge: Play Magic: the Gathering.
> Copyright © 2011 Forge Team
>
> This program is free software: you can redistribute it and/or modify it
> under the terms of the GNU General Public License as published by the Free
> Software Foundation, either version 3 of the License, or (at your option)
> any later version.

The full text of GPL-3.0-or-later is in `LICENSE-GPL-3.0-or-later` at the
repository root.

## Magic: The Gathering — name, rules, card content

Magic: The Gathering is a property of Wizards of the Coast LLC. Card names,
card text, set names, and trade dress are not licensed by this project; they
are used under fair use and fan-content policies for interoperability with
players' physical and digital collections. Card images are fetched at runtime
from [Scryfall](https://scryfall.com) and are subject to Scryfall's terms.

## Other dependencies

Runtime and build dependencies declared in `package.json`, `Cargo.toml`,
`yarn.lock`, and `Cargo.lock` retain their respective licenses. A consolidated
SBOM is produced as part of the release pipeline; see release artifacts for
the per-version dependency list.
