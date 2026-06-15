# forge-card-script

A parser and intermediate representation for the **Forge card-script DSL** — the line-oriented
text format used to describe Magic: The Gathering cards in the
[Forge](https://github.com/Card-Forge/forge) rules engine (`A:`, `T:`, `S:`, `R:`, `SVar:`,
`K:` lines, `$`-delimited parameter records, faces, and so on).

It is the shared front-end used by the [ManaBrew](https://github.com/witchesofthehill/manabrew)
engine and by [`forge-card-script-lsp`](https://crates.io/crates/forge-card-script-lsp).

## What it does

- **Line classification** — splits a card script into typed lines (`Field`, `Ability`,
  `Trigger`, `StaticAbility`, `Replacement`, `SVar`, `Keyword`, faces, …) with byte spans
  preserved for every key and value.
- **Parameter records** — parses `Key$ Value | Key$ Value` records, including SVar values that
  nest abilities, parameter records, or numeric expressions (`Count$`, `Remembered$`, …).
- **Diagnostics** — reports recoverable problems (missing `:`/`$`, empty keys, missing ability
  record, duplicate parameters) with spans, without ever failing to parse.
- **Semantic value typing** — `ParamEntry::semantic()` classifies a raw value into a
  `SemanticParamValue` (amount, selector, zone list, cost, comparison, produced mana, …).

```rust
use forge_card_script::{ParsedCardScript, ScriptLineKind};

let script = "Name:Lightning Bolt\n\
              ManaCost:R\n\
              Types:Instant\n\
              A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3\n";

let parsed = ParsedCardScript::parse(script);
assert!(parsed.diagnostics().is_empty());

for ability in parsed.abilities() {
    for param in ability.params.semantic_entries() {
        println!("{} => {:?}", param.key, param.value);
    }
}
```

## A note on semantic typing

`SemanticParamValue` classification is **heuristic** — it is driven by parameter-key name
patterns, not by an authoritative schema of the DSL. It is intended to power editor affordances
(hover, highlighting) and convenience accessors, not to be a complete or normative interpretation
of every Forge parameter. Treat `Raw` as the always-correct fallback.

## License

GPL-3.0-or-later. See the repository for details.
