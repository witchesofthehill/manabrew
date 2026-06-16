//! Alternative casting costs for spells and abilities.
//!
//! Mirrors Java's `AlternativeCost` — tracks how a spell was cast so resolution
//! can apply the correct behaviour (e.g. Evoke -> sacrifice on ETB, Dash -> haste + bounce).

use serde::{Deserialize, Serialize};

/// Alternative casting costs — mirrors Java's `AlternativeCost`.
/// Tracks how a spell was cast so resolution can apply the correct behaviour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AlternativeCost {
    Flashback,
    Spectacle,
    Evoke,
    Dash,
    Blitz,
    Escape,
    Overload,
    Madness,
    Foretell,
    Emerge,
    Suspend,
    /// Cast face-down as a 2/2 creature for {3} (Morph).
    Morph,
    /// Cast face-down as a 2/2 creature for {3}, +1/+1 counter on turn face-up (Megamorph).
    Megamorph,
    /// Cast as an Aura with enchant creature for the bestow cost.
    Bestow,
    /// Cast for warp cost; exile at beginning of next end step.
    Warp,
    /// Sacrifice-based alternative cost (e.g. Fireblast: sacrifice two Mountains).
    SacrificeAlt,
    /// Cast a plotted card from exile for free.
    Plot,
    /// Awaken — cast with awaken cost to animate a land.
    Awaken,
    /// Disturb — cast from graveyard transformed.
    Disturb,
    /// Harmonize — alternative cost for harmony effects.
    Harmonize,
    /// Freerunning — reduced cost when dealing combat damage.
    Freerunning,
    /// Impending — cast as a non-creature with time counters.
    Impending,
    /// Mayhem — alternative cost for mayhem effects.
    Mayhem,
    /// MTMtE — More Than Meets the Eye (Transformers) alternative cost.
    MTMtE,
    /// Mutate — cast on top of or under another creature.
    Mutate,
    /// Prowl — reduced cost when a creature of the same type dealt combat damage.
    Prowl,
    /// Sneak — alternative cost for sneaking into play.
    Sneak,
    /// Surge — reduced cost when you or a teammate cast another spell this turn.
    Surge,
    /// WebSlinging — alternative cost for web-slinging effects.
    WebSlinging,
    /// Plotted — the card was previously plotted and is now being cast.
    Plotted,
}

impl AlternativeCost {
    /// True if this is a morph-style face-down cast (Morph or Megamorph).
    pub fn is_morph(self) -> bool {
        matches!(self, AlternativeCost::Morph | AlternativeCost::Megamorph)
    }
}

/// Generic mana cost for casting a card face-down via Morph/Megamorph ({3}).
pub const MORPH_GENERIC_COST: i32 = 3;

/// Power and toughness of a face-down morph creature.
pub const MORPH_PT: i32 = 2;
