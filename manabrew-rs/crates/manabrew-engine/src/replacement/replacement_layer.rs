//! Replacement effect layer ordering.
//!
//! Mirrors Java `ReplacementLayer.java` in `forge/game/replacement/`.

use serde::{Deserialize, Serialize};

/// CR 614 / CR 616 layer ordering for replacement effects.
///
/// Multiple replacement effects that apply to the same event are applied in
/// the order below. Within the same layer the affected player chooses the order.
///
/// Reference: CR 616.1, Java `ReplacementLayer.java`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ReplacementLayer {
    /// CR 614.17 — effects that say an event "can't happen" (highest priority).
    CantHappen = 0,
    /// CR 616.1b — control-changing replacement effects.
    Control = 1,
    /// CR 616.1c — copy replacement effects.
    Copy = 2,
    /// CR 616.1d — transform replacement effects.
    Transform = 3,
    /// All other replacement effects (damage prevention, zone rerouting, etc.).
    Other = 4,
}

impl ReplacementLayer {
    /// Case-insensitive `Layer$` value parser. Mirrors Java
    /// `ReplacementLayer.smartValueOf()`. Returns `None` if unrecognised.
    pub fn smart_value_of(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "canthappen" => Some(Self::CantHappen),
            "control" => Some(Self::Control),
            "copy" => Some(Self::Copy),
            "transform" => Some(Self::Transform),
            "other" => Some(Self::Other),
            _ => None,
        }
    }
}
