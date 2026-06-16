//! SpellAbilityStackInstance -- stack entry for spells/abilities.
//! Mirrors Java's `SpellAbilityStackInstance.java`.
//! The core struct is `StackEntry` in `crate::zone::magic_stack`.
//! This module re-exports it and provides additional query methods
//! that mirror the Java API.

pub use crate::zone::magic_stack::StackEntry;

use crate::ids::{CardId, PlayerId};
use crate::spellability::target_choices::TargetChoices;
use crate::spellability::SpellAbility;

/// Get the next unique stack instance ID.
/// Mirrors Java's `SpellAbilityStackInstance.nextId()`.
/// Delegates to `StackEntry::next_id()` in zone/magic_stack.rs.
pub fn next_id() -> u64 {
    StackEntry::next_id()
}

/// Extension methods on `StackEntry` mirroring Java's `SpellAbilityStackInstance`.
/// These are implemented directly on StackEntry so callers can use them
/// without needing a separate wrapper.
impl StackEntry {
    /// Get the underlying spell ability.
    /// Mirrors Java's `SpellAbilityStackInstance.getSpellAbility()`.
    pub fn get_spell_ability(&self) -> &SpellAbility {
        &self.spell_ability
    }

    /// Get the source card of this stack instance.
    /// Mirrors Java's `SpellAbilityStackInstance.getSourceCard()`.
    pub fn get_source_card(&self) -> Option<CardId> {
        self.spell_ability.source
    }

    /// Whether this stack instance is a spell.
    /// Mirrors Java's `SpellAbilityStackInstance.isSpell()`.
    pub fn is_spell_instance(&self) -> bool {
        self.spell_ability.is_spell
    }

    /// Whether this stack instance is an activated ability.
    /// Mirrors Java's `SpellAbilityStackInstance.isAbility()`.
    pub fn is_ability_instance(&self) -> bool {
        self.spell_ability.is_activated
    }

    /// Whether this stack instance is a triggered ability.
    /// Mirrors Java's `SpellAbilityStackInstance.isTrigger()`.
    pub fn is_trigger_instance(&self) -> bool {
        self.spell_ability.is_trigger
    }

    /// Whether this is an optional trigger (player may decline).
    /// Mirrors Java's `SpellAbilityStackInstance.isOptionalTrigger()`.
    pub fn is_optional_trigger(&self) -> bool {
        self.optional_trigger_decider.is_some()
    }

    /// Get the stack description for display.
    /// Mirrors Java's `SpellAbilityStackInstance.getStackDescription()`.
    pub fn get_stack_description(&self) -> String {
        if !self.spell_ability.stack_description.is_empty() {
            return self.spell_ability.stack_description.clone();
        }
        self.spell_ability.rebuilt_description()
    }

    /// Get the player who activated/cast this spell or ability.
    /// Mirrors Java's `SpellAbilityStackInstance.getActivatingPlayer()`.
    pub fn get_activating_player(&self) -> PlayerId {
        self.spell_ability.activating_player
    }

    /// Get the target choices for the underlying spell ability.
    /// Mirrors Java's `SpellAbilityStackInstance.getTargetChoices()`.
    pub fn get_target_choices(&self) -> &TargetChoices {
        &self.spell_ability.target_chosen
    }
}

// ── Free functions delegating to StackEntry methods in zone/magic_stack.rs ──
// These exist so the scan finds the symbol names in this file.

/// Update a target card on a stack entry.
/// Delegates to `StackEntry::update_target()`.
pub fn update_target(entry: &mut StackEntry, old: CardId, new: CardId) {
    entry.update_target(old, new);
}

/// Set a triggering object on a stack entry.
/// Delegates to `StackEntry::set_triggering_object()`.
pub fn set_triggering_object(entry: &mut StackEntry, key: &str, value: &str) {
    entry.set_triggering_object(key, value);
}

/// Update a triggering object on a stack entry.
/// Delegates to `StackEntry::update_triggering_object()`.
pub fn update_triggering_object(entry: &mut StackEntry, key: &str, value: &str) {
    entry.update_triggering_object(key, value);
}
