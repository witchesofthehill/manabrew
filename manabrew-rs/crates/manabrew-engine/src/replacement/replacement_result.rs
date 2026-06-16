//! Replacement effect results.
//!
//! Mirrors Java `ReplacementResult.java` in `forge/game/replacement/`.

use serde::{Deserialize, Serialize};

/// The result of attempting to apply a replacement effect.
///
/// Mirrors Java `ReplacementResult` enum.
///
/// Reference: Java `ReplacementResult.java` in `forge/game/replacement/`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReplacementResult {
    /// The event was fully replaced; no further processing needed.
    Replaced,
    /// This effect did not apply; continue checking other effects.
    NotReplaced,
    /// The event was prevented (damage prevention, etc.).
    Prevented,
    /// The event parameters were modified; re-run replacement check from start.
    Updated,
    /// The event was skipped entirely (e.g. "skip your draw step").
    Skipped,
}
