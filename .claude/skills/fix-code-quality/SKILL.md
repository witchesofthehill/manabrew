---
name: fix-code-quality
description: "Pre-commit code quality enforcer. Scans all staged/changed Rust and TypeScript files for magic strings, poor abstraction, missing enums, separation-of-concerns violations, and disorganised file structure. Automatically refactors issues it finds. Must run before every commit."
---

# Fix Code Quality

You are a code quality enforcer. Before any commit is created, you scan every changed file and refactor code that violates the project's quality standards. You fix problems — you don't just report them.

## When This Runs

This skill is invoked **automatically before every commit**. The agent MUST load and execute this skill on all files that are about to be committed. No exceptions.

## What You Check and Fix

### 1. No Magic Strings

**Violation**: Raw string literals used inline for comparisons, keys, identifiers, or dispatch.

**Fix**: Extract to a `const` or an enum variant.

```rust
// BAD
if card.name == "Lightning Bolt" { ... }
if api_type == "DealDamage" { ... }

// GOOD
pub const LIGHTNING_BOLT: &str = "Lightning Bolt";
if card.name == LIGHTNING_BOLT { ... }

// Or better — if the string represents a finite set of known values, use an enum
```

**Exceptions**: Strings that match Java card script syntax are intentional (they maintain parity with Java's `forge-game`). These include:

- API type strings in `effect_dispatch!` macro invocations
- Filter expression syntax (`"Creature.YouCtrl"`)
- `script_name()` / `from_script_name()` return values
- Keyword prefix patterns (`"Kicker:"`, `"Flashback:"`)

If a string appears more than once and is NOT a Java-parity script string, it MUST be extracted.

### 2. Proper Enum Usage

**Violation**: Using strings, integers, or booleans where an enum would be more expressive and type-safe.

**Fix**: Introduce an enum.

```rust
// BAD
fn get_zone(zone: &str) -> ... { match zone { "Hand" => ..., "Graveyard" => ... } }
fn set_mode(mode: u8) -> ... { if mode == 1 { ... } else if mode == 2 { ... } }

// GOOD
enum ZoneType { Hand, Graveyard, ... }
fn get_zone(zone: ZoneType) -> ... { match zone { ZoneType::Hand => ..., } }
```

**Check for**:

- Functions that take `&str` or `u8`/`i32` when the set of valid values is known and finite
- `match` arms on strings or integers that represent categories
- Boolean parameters that would be clearer as a two-variant enum

### 3. Abstraction and Generics

**Violation**: Concrete types where a trait or generic would allow reuse. Duplicated logic across similar types.

**Fix**: Extract a trait, use generics, or create a shared function.

```rust
// BAD — duplicated logic
fn apply_to_creature(card: &Creature) -> Result<()> { /* 20 lines */ }
fn apply_to_artifact(card: &Artifact) -> Result<()> { /* same 20 lines */ }

// GOOD
fn apply_to<T: Permanent>(card: &T) -> Result<()> { /* 20 lines once */ }
```

**Check for**:

- Functions with identical or near-identical bodies operating on different types
- Large `match` arms where each arm does the same thing with minor variation
- Concrete types in function signatures that could be trait bounds

### 4. Separation of Concerns

**Violation**: A single function or file doing too many unrelated things.

**Fix**: Split into focused functions/modules.

**Check for**:

- Functions longer than ~80 lines (likely doing multiple things)
- Files mixing business logic with I/O, serialisation, or UI concerns
- Structs with methods that don't use `self` (should be free functions or in a different module)
- Game engine logic leaking into the Tauri/UI layer (`src-tauri/`) or vice versa

**Project-specific rule**: The engine crate (`manabrew-engine/`) must NEVER depend on Tauri, UI, or network types. The Tauri app (`src-tauri/`) translates between engine types and UI/network types — that boundary must stay clean.

### 5. File Organisation

**Violation**: Types, enums, or constants placed in wrong files or modules. God files containing too many unrelated items.

**Fix**: Move items to the correct module following existing project conventions.

**Project conventions**:

- Each effect gets its own file in `ability/effects/` (mirroring Java's `ability/effects/` package)
- Each static ability gets its own file in `staticability/`
- Foundation types (`Color`, `ZoneType`, `PhaseType`, `Mana`, `CardType`) live in `forge-foundation`
- Game state types live in `manabrew-engine`
- Card database types live in `forge-carddb`
- File names MUST match Java counterpart names (see CLAUDE.md)

**Check for**:

- New types/enums added to an existing file where they'd be better in their own module
- Constants scattered across files instead of centralised in a dedicated `constants` module or the type they belong to
- `pub use` re-exports that bypass module boundaries

### 6. Enum Organisation

**Violation**: Enums with variants that don't belong together, or related constants spread across multiple places.

**Fix**: Group related variants. Extract sub-enums if an enum exceeds ~30 variants with clearly distinct categories.

**Check for**:

- Enum variants that are never matched together (may belong in separate enums)
- Related `const` values that should be enum variants
- Missing `impl` blocks for enum utility methods (`from_str`, `display`, `is_*` predicates)
- Enums without `#[derive(Debug, Clone, Copy, PartialEq, Eq)]` where appropriate

### 7. Functional Style

**Violation**: Imperative loops and mutable accumulators where iterators would be clearer.

**Fix**: Use iterator chains, `map`, `filter`, `collect`, `fold`.

```rust
// BAD
let mut results = Vec::new();
for item in items {
    if item.is_valid() {
        results.push(item.transform());
    }
}

// GOOD
let results: Vec<_> = items.iter()
    .filter(|item| item.is_valid())
    .map(|item| item.transform())
    .collect();
```

**Check for**:

- `for` loops that build a `Vec` with `push` (use `collect`)
- `for` loops with a running accumulator (use `fold` or `sum`)
- Nested `if` inside `for` (use `filter`)
- Mutable variables that are written once (use `let` binding from an expression)

**Don't over-apply**: Some imperative code is clearer than a dense iterator chain. Use judgment — if the iterator version is harder to read, keep the loop.

## Workflow

### Step 1: Identify Changed Files

Determine which files are staged for commit or have been modified. Focus only on:

- `*.rs` files in `manabrew-engine/`, `src-tauri/src/`
- `*.ts` / `*.tsx` files in `src/`

Ignore: test files (unless they contain production utilities), generated files, JSON data files, Java reference files.

### Step 2: Read and Analyse Each File

For each changed file:

1. Read the full file content
2. Check against all 7 quality rules above
3. Note every violation with file path, line number, and the specific rule violated

### Step 3: Fix Violations

For each violation:

1. Apply the fix using Edit tool
2. Ensure the fix maintains Java parity (check CLAUDE.md rules)
3. Ensure the fix doesn't change public API signatures unless necessary
4. If a fix requires creating a new file (e.g., extracting an enum to its own module), follow project naming conventions

### Step 4: Verify

After all fixes:

1. Run `cargo check` on the workspace to ensure no compilation errors
2. If TypeScript files were changed, verify no type errors
3. Report a summary of all changes made

### Step 5: Report

```markdown
## Code Quality Fixes Applied

### Files Modified

- `path/to/file.rs` — [what was fixed]

### Violations Found and Fixed

| #   | File        | Rule          | Description                    | Fix Applied              |
| --- | ----------- | ------------- | ------------------------------ | ------------------------ |
| 1   | `path:line` | Magic Strings | `"foo"` used 3 times inline    | Extracted to `const FOO` |
| 2   | `path:line` | Enum Usage    | `mode: u8` with 4 known values | Created `Mode` enum      |

### Violations Skipped (with reason)

- [any violations intentionally not fixed, e.g., Java-parity strings]

### Build Verification

- `cargo check`: PASS / FAIL
```

## Rules

1. **Fix, don't just report.** This skill modifies code. It's not a linter — it's a refactorer.
2. **Preserve Java parity.** Never rename files or change public interfaces in ways that break parity with `forge/forge-game/`. Check CLAUDE.md.
3. **Don't break the build.** Always run `cargo check` after changes. If a fix introduces a compile error, revert it.
4. **Be conservative with abstraction.** Only introduce traits/generics when there's clear duplication. Don't over-engineer.
5. **Respect existing patterns.** Follow how the codebase already handles enums, constants, and modules — don't invent new conventions.
6. **Scope to the diff.** Only fix issues in files that are part of the current commit. Don't go refactoring the entire codebase.
