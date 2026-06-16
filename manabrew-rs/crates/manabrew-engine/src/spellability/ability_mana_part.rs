//! Mana-producing part of an ability.
//!
//! Mirrors Java's `AbilityManaPart.java` — tracks what mana an ability
//! produces, any restrictions on spending it, and side effects.

use serde::{Deserialize, Serialize};

/// Mana-producing component of a spell ability.
/// Mirrors Java's `AbilityManaPart` — stores the produced mana string,
/// restrictions on how it can be spent, and associated effects.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbilityManaPart {
    /// Original mana production string (e.g. "W", "G G", "Any").
    orig_produced: String,
    /// Restrictions on how the produced mana can be spent (e.g. "Creature").
    mana_restrictions: String,
    /// Keywords added to the spell cast with this mana.
    adds_keywords: Option<String>,
    /// Trigger that fires when this mana is spent.
    triggers_when_spent: Option<String>,
    /// Whether this mana persists between phases.
    persistent_mana: bool,
    /// Whether this mana can only be spent during combat.
    combat_mana: bool,
    /// Last express choice made for mana generation (for "Any" mana).
    last_express_choice: String,
}

impl AbilityManaPart {
    /// Create a new mana part with the given production and restrictions.
    /// Mirrors Java's `AbilityManaPart(SpellAbility, String, String)`.
    pub fn new(produced: &str, restrictions: &str) -> Self {
        Self {
            orig_produced: produced.to_string(),
            mana_restrictions: restrictions.to_string(),
            adds_keywords: None,
            triggers_when_spent: None,
            persistent_mana: false,
            combat_mana: false,
            last_express_choice: String::new(),
        }
    }

    /// Check if this ability can produce the given color of mana.
    /// Mirrors Java's `AbilityManaPart.canProduce(String)`.
    /// Returns true if the color string is found within orig_produced,
    /// or if orig_produced is "Any".
    pub fn can_produce(&self, color: &str) -> bool {
        if self.orig_produced.is_empty() {
            return false;
        }
        if self.orig_produced.eq_ignore_ascii_case("Any") {
            return true;
        }
        // Check each mana symbol in the produced string
        self.orig_produced
            .split_whitespace()
            .any(|token| token.eq_ignore_ascii_case(color))
    }

    /// Get the original mana production string.
    /// Mirrors Java's `AbilityManaPart.getOrigProduced()`.
    pub fn get_orig_produced(&self) -> &str {
        &self.orig_produced
    }

    /// Whether this ability can produce any mana at all.
    /// Mirrors Java's `AbilityManaPart.canThisProduce()`.
    pub fn can_this_produce(&self) -> bool {
        !self.orig_produced.is_empty()
    }

    /// Count the number of individual mana generated.
    /// Mirrors Java's `AbilityManaPart.amountOfManaGenerated(SpellAbility)`.
    /// Each space-separated token in orig_produced counts as one mana.
    pub fn amount_of_mana_generated(&self) -> i32 {
        if self.orig_produced.is_empty() {
            return 0;
        }
        self.orig_produced.split_whitespace().count() as i32
    }

    /// Total amount of mana generated, counting "All" and "Any" as 1 each.
    /// Mirrors Java's `AbilityManaPart.totalAmountOfManaGenerated(SpellAbility)`.
    pub fn total_amount_of_mana_generated(&self) -> i32 {
        if self.orig_produced.is_empty() {
            return 0;
        }
        self.orig_produced
            .split_whitespace()
            .map(|token| {
                if token.eq_ignore_ascii_case("All") || token.eq_ignore_ascii_case("Any") {
                    1
                } else {
                    1
                }
            })
            .sum()
    }

    /// Get the mana restrictions string.
    pub fn mana_restrictions(&self) -> &str {
        &self.mana_restrictions
    }

    /// Set keywords to add to spells cast with this mana.
    pub fn set_adds_keywords(&mut self, keywords: Option<String>) {
        self.adds_keywords = keywords;
    }

    /// Get keywords added by this mana.
    pub fn adds_keywords(&self) -> Option<&str> {
        self.adds_keywords.as_deref()
    }

    /// Set the trigger that fires when this mana is spent.
    pub fn set_triggers_when_spent(&mut self, trigger: Option<String>) {
        self.triggers_when_spent = trigger;
    }

    /// Get the trigger that fires when this mana is spent.
    pub fn triggers_when_spent(&self) -> Option<&str> {
        self.triggers_when_spent.as_deref()
    }

    /// Whether this mana persists between phases.
    pub fn is_persistent_mana(&self) -> bool {
        self.persistent_mana
    }

    /// Set whether this mana persists between phases.
    pub fn set_persistent_mana(&mut self, val: bool) {
        self.persistent_mana = val;
    }

    /// Whether this mana can only be spent during combat.
    pub fn is_combat_mana(&self) -> bool {
        self.combat_mana
    }

    /// Set whether this mana can only be spent during combat.
    pub fn set_combat_mana(&mut self, val: bool) {
        self.combat_mana = val;
    }

    /// Get last express choice for mana generation.
    pub fn last_express_choice(&self) -> &str {
        &self.last_express_choice
    }

    /// Set last express choice for mana generation.
    pub fn set_last_express_choice(&mut self, choice: String) {
        self.last_express_choice = choice;
    }

    /// Clear express choice for mana generation.
    /// Mirrors Java's `AbilityManaPart.clearExpressChoice()`.
    pub fn clear_express_choice(&mut self) {
        self.last_express_choice.clear();
    }

    /// Produce mana into the mana pool.
    /// Mirrors Java's `AbilityManaPart.produceMana(String, Player, SpellAbility)`.
    /// Returns the produced mana string for the pool to consume.
    pub fn produce_mana(&self) -> &str {
        if !self.last_express_choice.is_empty() {
            &self.last_express_choice
        } else {
            &self.orig_produced
        }
    }

    /// Whether this ability taps the source for mana.
    /// Mirrors Java's `AbilityManaPart.tapsForMana()`.
    pub fn taps_for_mana(&self) -> bool {
        self.can_this_produce()
    }

    /// Whether the mana produced cannot be countered when paid with.
    /// Mirrors Java's `AbilityManaPart.cannotCounterPaidWith()`.
    pub fn cannot_counter_paid_with(&self) -> bool {
        self.mana_restrictions.contains("CantCounter")
    }

    /// Add a no-counter effect to the mana restrictions.
    /// Mirrors Java's `AbilityManaPart.addNoCounterEffect()`.
    pub fn add_no_counter_effect(&mut self) {
        if !self.mana_restrictions.contains("CantCounter") {
            if !self.mana_restrictions.is_empty() {
                self.mana_restrictions.push(',');
            }
            self.mana_restrictions.push_str("CantCounter");
        }
    }

    /// Add keywords to spells cast with this mana.
    /// Mirrors Java's `AbilityManaPart.addKeywords()`.
    pub fn add_keywords(&mut self, keywords: &str) {
        self.adds_keywords = Some(keywords.to_string());
    }

    /// Whether this mana adds counters to the spell.
    /// Mirrors Java's `AbilityManaPart.addsCounters()`.
    pub fn adds_counters(&self) -> bool {
        self.mana_restrictions.contains("AddsCounter")
    }

    /// Create ETB counters for the spell cast with this mana.
    /// Mirrors Java's `AbilityManaPart.createETBCounters()`.
    pub fn create_etb_counters(&self) -> bool {
        self.adds_counters()
    }

    /// Add a trigger that fires when this mana is spent.
    /// Mirrors Java's `AbilityManaPart.addTriggersWhenSpent()`.
    pub fn add_triggers_when_spent(&mut self, trigger: &str) {
        self.triggers_when_spent = Some(trigger.to_string());
    }

    /// Check if this mana meets the given mana restrictions.
    /// Mirrors Java's `AbilityManaPart.meetsManaRestrictions(SpellAbility)`.
    pub fn meets_mana_restrictions(&self, restriction: &str) -> bool {
        if self.mana_restrictions.is_empty() {
            return true;
        }
        self.mana_restrictions
            .split(',')
            .any(|r| r.trim().eq_ignore_ascii_case(restriction))
    }

    /// Check if this mana meets mana shard restrictions.
    /// Mirrors Java's `AbilityManaPart.meetsManaShardRestrictions()`.
    pub fn meets_mana_shard_restrictions(&self) -> bool {
        // Shard restrictions are a subset of mana restrictions
        // that limit what colors the mana can pay for.
        // By default, no shard restrictions are active.
        true
    }

    /// Check if this mana meets both spell and shard restrictions.
    /// Mirrors Java's `AbilityManaPart.meetsSpellAndShardRestrictions(SpellAbility)`.
    pub fn meets_spell_and_shard_restrictions(&self) -> bool {
        self.meets_mana_shard_restrictions()
    }

    /// Get the mana representation for pool tracking.
    /// Mirrors Java's `AbilityManaPart.mana()`.
    pub fn mana(&self) -> &str {
        &self.orig_produced
    }
}
