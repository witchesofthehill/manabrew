//! ISpellAbility trait -- marker trait for spell abilities.
//! Mirrors Java's `ISpellAbility.java`.

/// Marker trait for types that can be placed on the stack and resolved.
/// In Rust, `SpellAbility` is the sole implementor.
pub trait ISpellAbility {
    /// Whether this is a spell (cast from hand/zone, uses the stack).
    fn is_spell(&self) -> bool;
    /// Whether this is an activated ability.
    fn is_ability(&self) -> bool;
    /// Whether this is a triggered ability.
    fn is_trigger(&self) -> bool;
}

impl ISpellAbility for super::SpellAbility {
    fn is_spell(&self) -> bool {
        self.is_spell
    }
    fn is_ability(&self) -> bool {
        self.is_activated
    }
    fn is_trigger(&self) -> bool {
        self.is_trigger
    }
}
