//! Typed accessor helpers for SpellAbility parameters.
//!
//! These methods replace raw parameter lookups with
//! typed accessors that are discoverable via autocomplete and catch
//! typos at compile time.

use super::SpellAbility;
use crate::ability::ability_ir::DefinedRef;
use crate::ability::ProducedMana;
use crate::card::CounterType;
use crate::parsing::{keys, CompiledSelector};
use forge_foundation::ZoneType;

/// Typed accessors for common SpellAbility parameters.
/// These mirror the param keys used in Java Forge's ability text format.
impl SpellAbility {
    // ── Card/Target filters ────────────────────────────────────────────────

    /// Get the compiled `ValidCard$` filter.
    pub fn valid_card(&self) -> Option<&CompiledSelector> {
        self.ir.valid_card_selector.as_ref()
    }

    /// Get the compiled `ValidPlayer$` filter.
    pub fn valid_player(&self) -> Option<&CompiledSelector> {
        self.ir.valid_player_selector.as_ref()
    }

    /// Get the compiled `ValidTarget$` filter.
    pub fn valid_target(&self) -> Option<&CompiledSelector> {
        self.ir.valid_target_selector.as_ref()
    }

    /// Get the `ChangeType$` filter string (used by zone-change effects).
    pub fn change_type(&self) -> Option<&str> {
        self.ir.change_type.as_deref()
    }

    /// Get the compiled `ChangeType$` filter.
    pub fn change_type_selector(&self) -> Option<&CompiledSelector> {
        self.ir.change_type_selector.as_ref()
    }

    // ── Zone/movement params ───────────────────────────────────────────────

    /// Get the `Defined$` card reference (e.g. "Self", "Remembered", "Targeted").
    pub fn defined(&self) -> Option<&str> {
        self.ir.defined_text.as_deref()
    }

    /// Get the first parsed `Defined$` card reference.
    pub fn defined_ref(&self) -> Option<&DefinedRef> {
        self.ir
            .defined
            .as_ref()
            .and_then(|defined| defined.refs.first())
    }

    /// Get the `DefinedPlayer$` player reference (e.g. "Player", "You", "Opponent").
    pub fn defined_player(&self) -> Option<&str> {
        self.ir.defined_player_text.as_deref()
    }

    /// Get the `Origin$` zone type string.
    pub fn origin(&self) -> Option<&str> {
        self.ir.origin_text.as_deref()
    }

    /// Get the `Origin$` zone type.
    pub fn origin_zone(&self) -> Option<ZoneType> {
        self.ir.origin_zone
    }

    /// Get the `Origin$` zone list.
    pub fn origin_zones(&self) -> Vec<ZoneType> {
        self.ir.origin_zones.clone()
    }

    /// Get the `Destination$` zone type string.
    pub fn destination(&self) -> Option<&str> {
        self.ir.destination_text.as_deref()
    }

    /// Get the `Destination$` zone type.
    pub fn destination_zone(&self) -> Option<ZoneType> {
        self.ir.destination_zone
    }

    /// Get the `LibraryPosition$` string (e.g. "0", "-1", "Bottom").
    pub fn library_position(&self) -> Option<&str> {
        self.ir.library_position.as_deref()
    }

    /// Get the `LibraryPosition2$` string for secondary zone placement.
    pub fn library_position_2(&self) -> Option<&str> {
        self.ir.library_position_2.as_deref()
    }

    /// Get the `LibraryPositionAlternative$` string for `DestinationAlternative$`.
    pub fn library_position_alternative(&self) -> Option<&str> {
        self.ir.library_position_alternative.as_deref()
    }

    // ── Mana/cost params ───────────────────────────────────────────────────

    /// Get the lowered `Produced$` mana expression.
    pub fn produced_ir(&self) -> Option<&ProducedMana> {
        self.ir.produced_ir.as_ref()
    }

    // ── Boolean params ─────────────────────────────────────────────────────

    /// Check if a boolean param is set to "True" (case-insensitive).
    /// This is a more discoverable alias for the existing `param_is_true`.
    pub fn is_param_true(&self, key: &str) -> bool {
        self.param_is_true(key)
    }

    /// Get `Hidden$` as boolean.
    pub fn is_hidden(&self) -> bool {
        self.ir.hidden
    }

    /// Get `Mandatory$` as boolean.
    pub fn is_mandatory(&self) -> bool {
        self.ir.mandatory
    }

    /// Get `Tapped$` as boolean.
    pub fn is_tapped(&self) -> bool {
        self.ir.tapped
    }

    /// Get `Shuffle$` as boolean.
    pub fn is_shuffle(&self) -> bool {
        self.ir.shuffle
    }

    /// Get `RememberChanged$` as boolean.
    pub fn is_remember_changed(&self) -> bool {
        self.ir.remember_changed
    }

    /// Get `Optional$` as boolean.
    pub fn is_optional(&self) -> bool {
        self.ir.optional
    }

    /// Get `GainControl$` as boolean.
    pub fn is_gain_control(&self) -> bool {
        self.ir.gain_control
    }

    /// Get `ForgetChanged$` as boolean.
    pub fn is_forget_changed(&self) -> bool {
        self.ir.forget_changed
    }

    /// Get `Imprint$` as boolean.
    pub fn is_imprint(&self) -> bool {
        self.ir.imprint
    }

    /// Get `FaceDown$` as boolean.
    pub fn is_face_down(&self) -> bool {
        self.ir.face_down
    }

    /// Get `ExileFaceDown$` as boolean.
    pub fn is_exile_face_down(&self) -> bool {
        self.ir.exile_face_down
    }

    /// Get `Transformed$` as boolean.
    pub fn is_transformed(&self) -> bool {
        self.ir.transformed
    }

    /// Get `AtRandom$` as boolean.
    pub fn is_at_random(&self) -> bool {
        self.ir.at_random
    }

    /// Get `Reveal$` as boolean (default true for searches — NoReveal overrides).
    pub fn is_reveal(&self) -> bool {
        self.ir.reveal
    }

    /// Get `ChangeNum$` as usize, defaulting to 1.
    pub fn change_num(&self) -> usize {
        self.ir.change_num
    }

    /// Get `Chooser$` player reference.
    pub fn chooser(&self) -> Option<&str> {
        self.ir.chooser.as_deref()
    }

    /// Get `AttachedTo$` target definition.
    pub fn attached_to(&self) -> Option<&str> {
        self.ir.attached_to.as_deref()
    }

    /// Get `DestinationAlternative$` zone.
    pub fn destination_alternative(&self) -> Option<&str> {
        self.ir.destination_alternative.as_deref()
    }

    /// Get `SelectPrompt$` custom prompt text.
    pub fn select_prompt(&self) -> Option<&str> {
        self.ir.select_prompt.as_deref()
    }

    // ── Numeric params ─────────────────────────────────────────────────────

    /// Get a numeric param by key, returning None if absent or non-numeric.
    pub fn param_as_i32(&self, key: &str) -> Option<i32> {
        match key {
            keys::WITH_TOTAL_CMC => self.ir.with_total_cmc,
            keys::WITH_TOTAL_POWER => self.ir.with_total_power,
            _ => None,
        }
    }

    // ── SubAbility chain ───────────────────────────────────────────────────

    /// Get the `SubAbility$` SVar name.
    pub fn sub_ability_name(&self) -> Option<&str> {
        self.ir.sub_ability_name.as_deref()
    }

    // ── Token params ───────────────────────────────────────────────────────

    /// Get the `TokenScript$` name.
    pub fn token_script(&self) -> Option<&str> {
        self.ir.token_script.as_deref()
    }

    /// Get the `TokenOwner$` reference.
    pub fn token_owner(&self) -> Option<&str> {
        self.ir.token_owner.as_deref()
    }

    // ── Counter params ─────────────────────────────────────────────────────

    /// Get the `WithCountersType$` string.
    pub fn with_counters_type(&self) -> Option<&str> {
        self.ir.with_counters_type_text.as_deref()
    }

    /// Get the typed `WithCountersType$`.
    pub fn with_counters_type_enum(&self) -> Option<&CounterType> {
        self.ir.with_counters_type.as_ref()
    }
}
