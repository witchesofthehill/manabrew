//! Rust parity model for Java `CardTraitChanges`.

use crate::ids::CardId;
use crate::replacement::ReplacementEffect;
use crate::spellability::SpellAbility;
use crate::staticability::{StaticAbility, StaticMode};
use crate::trigger::Trigger;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CardTraitChanges {
    pub abilities: Vec<SpellAbility>,
    pub removed_abilities: Vec<SpellAbility>,
    pub triggers: Vec<Trigger>,
    pub replacements: Vec<ReplacementEffect>,
    pub static_abilities: Vec<StaticAbility>,
    /// Java parity subset for predicate removal: true means remove all existing
    /// card traits before applying additions (used by addChangedCardTraitsByText).
    pub remove_all: bool,
}

impl CardTraitChanges {
    pub fn remove_all_layer(
        abilities: Vec<SpellAbility>,
        triggers: Vec<Trigger>,
        replacements: Vec<ReplacementEffect>,
        static_abilities: Vec<StaticAbility>,
    ) -> Self {
        Self {
            abilities,
            removed_abilities: Vec::new(),
            triggers,
            replacements,
            static_abilities,
            remove_all: true,
        }
    }

    /// Return true when any injected static ability changes casting cost.
    pub fn contains_cost_change(&self) -> bool {
        self.static_abilities.iter().any(|st_ab| {
            st_ab.check_mode(&StaticMode::ReduceCost) || st_ab.check_mode(&StaticMode::RaiseCost)
        })
    }

    /// Java-parity copy hook.
    /// Host/LKI-specific rewrites are not yet modeled in Rust, so this clones.
    pub fn copy(&self, _host: CardId, _lki: bool) -> Self {
        self.clone()
    }

    /// Java-parity text-rewrite hook.
    /// Normalizes mutable text payloads carried by trait changes.
    pub fn change_text(&mut self) {
        for sa in &mut self.abilities {
            sa.ability_text = sa.ability_text.trim().to_string();
        }
        for sa in &mut self.removed_abilities {
            sa.ability_text = sa.ability_text.trim().to_string();
        }
    }

    pub fn apply_spell_ability(&self, mut list: Vec<SpellAbility>) -> Vec<SpellAbility> {
        if self.remove_all {
            list.clear();
        }
        for removed in &self.removed_abilities {
            list.retain(|sa| {
                !(sa.source == removed.source
                    && sa.api == removed.api
                    && sa.ability_text == removed.ability_text)
            });
        }
        list.extend(self.abilities.iter().cloned());
        list
    }

    pub fn apply_trigger(&self, mut list: Vec<Trigger>) -> Vec<Trigger> {
        if self.remove_all {
            list.clear();
        }
        list.extend(self.triggers.iter().cloned());
        list
    }

    pub fn apply_replacement_effect(
        &self,
        mut list: Vec<ReplacementEffect>,
    ) -> Vec<ReplacementEffect> {
        if self.remove_all {
            list.clear();
        }
        list.extend(self.replacements.iter().cloned());
        list
    }

    pub fn apply_static_ability(&self, mut list: Vec<StaticAbility>) -> Vec<StaticAbility> {
        if self.remove_all {
            list.clear();
        }
        list.extend(self.static_abilities.iter().cloned());
        list
    }
}

impl crate::card::trait_card_trait_changes::CardTraitChanges for CardTraitChanges {
    fn apply_spell_ability(&self, list: Vec<SpellAbility>) -> Vec<SpellAbility> {
        CardTraitChanges::apply_spell_ability(self, list)
    }

    fn apply_trigger(&self, list: Vec<Trigger>) -> Vec<Trigger> {
        CardTraitChanges::apply_trigger(self, list)
    }

    fn apply_replacement_effect(&self, list: Vec<ReplacementEffect>) -> Vec<ReplacementEffect> {
        CardTraitChanges::apply_replacement_effect(self, list)
    }

    fn apply_static_ability(&self, list: Vec<StaticAbility>) -> Vec<StaticAbility> {
        CardTraitChanges::apply_static_ability(self, list)
    }

    fn change_text(&mut self) {
        CardTraitChanges::change_text(self);
    }

    fn copy(
        &self,
        host: CardId,
        lki: bool,
    ) -> Box<dyn crate::card::trait_card_trait_changes::CardTraitChanges> {
        Box::new(CardTraitChanges::copy(self, host, lki))
    }
}
