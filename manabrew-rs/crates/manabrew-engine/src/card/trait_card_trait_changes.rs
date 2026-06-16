//! Rust trait parity for Java `ICardTraitChanges`.

use crate::ids::CardId;
use crate::replacement::ReplacementEffect;
use crate::spellability::SpellAbility;
use crate::staticability::StaticAbility;
use crate::trigger::Trigger;

/// Java-parity contract for applying trait/ability mutations to a card's
/// spell abilities, triggers, replacements, and static abilities.
pub trait CardTraitChanges {
    fn apply_spell_ability(&self, list: Vec<SpellAbility>) -> Vec<SpellAbility> {
        list
    }

    fn apply_trigger(&self, list: Vec<Trigger>) -> Vec<Trigger> {
        list
    }

    fn apply_replacement_effect(&self, list: Vec<ReplacementEffect>) -> Vec<ReplacementEffect> {
        list
    }

    fn apply_static_ability(&self, list: Vec<StaticAbility>) -> Vec<StaticAbility> {
        list
    }

    fn change_text(&mut self);

    fn copy(&self, host: CardId, lki: bool) -> Box<dyn CardTraitChanges>;
}
