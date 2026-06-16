// Engine functions mirror Java's method signatures, which are frequently 7+
// args by design (gameState, sourceCard, sourceAbility, target, etc). Refactoring
// each into a context struct would diverge from the Java reference, so we suppress
// the clippy lint at the crate level.
#![allow(clippy::too_many_arguments)]
// Several types in the port intentionally mirror Java collections that nest
// generics deeply. Replacing them with `type` aliases would obscure the parity.
#![allow(clippy::type_complexity)]
// Several modules use ordered list-style doc comments ("1.", "2.", "Plus") that
// rustdoc renders correctly but trigger clippy's lazy-continuation lint.
#![allow(clippy::doc_lazy_continuation)]
// Many if/else chains mirror Java's verbose conditionals where multiple
// branches deliberately reach the same outcome for separate logical predicates.
// Collapsing them would obscure the parity with the source.
#![allow(clippy::if_same_then_else)]
// `match` blocks inside `if let` mirror Java's pattern of nested `if (x instanceof Y)` checks.
#![allow(clippy::collapsible_match)]

pub mod ability;
pub mod action;
pub mod agent;
pub mod card;
pub mod card_trait_base;
pub mod combat;
pub mod core;
pub mod cost;
pub mod event;
pub mod game;
pub mod game_log;
pub mod game_log_entry;
pub mod game_log_entry_type;
pub mod game_log_formatter;
pub mod game_loop;
pub mod game_object;
pub mod game_rng;
pub mod game_runtime;
pub mod game_snapshot;
pub mod ids;
pub mod keyword;
pub mod lki;
pub mod mana;
pub mod mulligan;
pub mod parsing;
pub mod perf;
pub mod phase;
pub mod player;
pub mod replacement;
pub mod spellability;
pub mod staticability;
pub mod svar;
pub mod trigger;
pub mod util;
pub mod zone;
