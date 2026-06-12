//! Last-Known Information (LKI) system.
//!
//! Mirrors Java's `Game.copyLastState()` + `Game.lastStateBattlefield`.
//!
//! ## Overview
//!
//! The LKI system maintains two types of snapshots to resolve trigger SVars
//! (e.g. `TriggeredCard$CardPower`) using a card's state at the time it was
//! last on the battlefield:
//!
//! 1. **Periodic snapshots** (`GameState.last_state_battlefield`):
//!    - Captured by `copy_last_state()` at key checkpoints (phase transitions,
//!      before SBAs, before combat)
//!    - Lightweight `CardSnapshot` structs for all battlefield cards
//!    - Stale snapshots persist after cards leave (for LKI lookups)
//!
//! 2. **Per-card LKI** (`Card.lki_power` / `lki_toughness`):
//!    - Saved in `action.rs::change_zone()` when a card leaves the battlefield
//!    - Captures the exact power/toughness at zone-change time
//!    - Primary source for trigger SVars
//!
//! ## Resolution hierarchy
//!
//! When resolving `TriggeredCard$CardPower` / `TriggeredCard$CardToughness`:
//! 1. Check `card.lki_power` / `card.lki_toughness` (captured at zone change)
//! 2. If zero, check periodic snapshot (in case card entered after last checkpoint)
//! 3. Fall back to zero if neither source has data
//!
//! ## Lifecycle
//!
//! ```text
//! Card enters battlefield
//!   → assign zone timestamp
//!   → update_lki_snapshot() creates/updates periodic snapshot
//!
//! Phase transition / SBA check
//!   → copy_last_state() refreshes all battlefield snapshots
//!
//! Card leaves battlefield (dies, exiled, etc.)
//!   → action.rs captures lki_power/lki_toughness
//!   → periodic snapshot remains (stale but valid for LKI)
//!
//! Trigger fires (e.g. "When ~ dies, deal damage equal to its power")
//!   → resolve_lki_power() checks lki_power, then periodic snapshot
//!   → SpellAbility resolves with correct LKI value
//! ```
//!
//! ## Java equivalents
//!
//! - `Game.copyLastState()` → `GameState::copy_last_state()`
//! - `Game.lastStateBattlefield` → `GameState.last_state_battlefield`
//! - `Card.getPower()` (during trigger) → `resolve_lki_power()`

use crate::card::{Card, CounterType};
use crate::ids::{CardId, PlayerId};
use crate::spellability::SpellAbility;
use forge_foundation::ZoneType;
use std::collections::BTreeMap;

/// Lightweight snapshot of a card's state on the battlefield.
/// Captured by `GameState::copy_last_state()` at key checkpoints.
#[derive(Debug, Clone)]
pub struct CardSnapshot {
    pub id: CardId,
    pub controller: PlayerId,
    pub owner: PlayerId,
    pub power: i32,
    pub toughness: i32,
    pub counters: BTreeMap<CounterType, i32>,
    pub tapped: bool,
    pub zone: ZoneType,
    pub card_name: String,
}

impl CardSnapshot {
    /// Create a snapshot from a live card.
    pub fn from_card(card: &Card) -> Self {
        Self {
            id: card.id,
            controller: card.controller,
            owner: card.owner,
            power: card.power(),
            toughness: card.toughness(),
            counters: card.counters.clone(),
            tapped: card.tapped,
            zone: card.zone,
            card_name: card.card_name.clone(),
        }
    }
}

/// LKI methods for `GameState`.
/// Implemented in this module to keep all LKI logic centralized.
impl crate::game::GameState {
    /// Snapshot all battlefield cards for LKI.
    /// Mirrors Java's `Game.copyLastState()`.
    /// Called at phase transitions, before SBAs, before combat.
    pub fn copy_last_state(&mut self) {
        // Update existing snapshots for cards still on the battlefield.
        // Add new snapshots for cards that entered since last checkpoint.
        // Keep stale snapshots for cards that left — they serve as LKI
        // for trigger SVars like TriggeredCard$CardPower.
        // This matches Java's behavior where lastStateBattlefield is only
        // fully cleared at major checkpoints but individual entries persist
        // through resolution chains.
        for card in self.cards.iter() {
            if card.zone == ZoneType::Battlefield {
                if let Some(existing) = self
                    .last_state_battlefield
                    .iter_mut()
                    .find(|s| s.id == card.id)
                {
                    *existing = CardSnapshot::from_card(card);
                } else {
                    self.last_state_battlefield
                        .push(CardSnapshot::from_card(card));
                }
            }
        }
    }

    /// Look up a card's LKI snapshot from the last battlefield state.
    /// Returns None if the card wasn't on the battlefield at the last checkpoint.
    pub fn get_lki_snapshot(&self, card_id: CardId) -> Option<&CardSnapshot> {
        self.last_state_battlefield.iter().find(|s| s.id == card_id)
    }

    /// Update the LKI snapshot for a specific card on the battlefield.
    /// If the card is already in the snapshot, update it. Otherwise, add it.
    /// Called when a card enters the battlefield or its state changes significantly.
    /// Mirrors Java's incremental LKI updates between full copyLastState() calls.
    pub fn update_lki_snapshot(&mut self, card_id: CardId) {
        let card = &self.cards[card_id.index()];
        if card.zone != ZoneType::Battlefield {
            return;
        }
        let snapshot = CardSnapshot::from_card(card);
        if let Some(existing) = self
            .last_state_battlefield
            .iter_mut()
            .find(|s| s.id == card_id)
        {
            *existing = snapshot;
        } else {
            self.last_state_battlefield.push(snapshot);
        }
    }
}

/// Resolve LKI power for a trigger source card.
///
/// Checks `card.lki_power` (captured at zone-change time) first, then falls
/// back to the periodic snapshot if `lki_power` is zero and a snapshot exists
/// with non-zero power.
///
/// This handles the edge case where a card dies/leaves after entering the
/// battlefield but before the next `copy_last_state()` checkpoint — the
/// per-card LKI captures the correct value at zone-change time.
///
/// Returns 0 if no LKI data exists.
pub fn resolve_lki_power(game: &crate::game::GameState, trigger_src: CardId) -> i32 {
    // Check per-card LKI captured at zone-change time (most accurate).
    // Some(0) is a valid LKI value (e.g. creature with -1/-1 counters reducing power to 0).
    if let Some(lki) = game.card(trigger_src).lki_power {
        return lki;
    }
    // No per-card LKI — fall back to periodic snapshot.
    if let Some(snapshot) = game.get_lki_snapshot(trigger_src) {
        return snapshot.power;
    }
    0
}

/// Resolve LKI toughness for a trigger source card.
///
/// Checks `card.lki_toughness` (captured at zone-change time) first, then
/// falls back to the periodic snapshot if `lki_toughness` is zero and a
/// snapshot exists.
///
/// Returns 0 if no LKI data exists.
pub fn resolve_lki_toughness(game: &crate::game::GameState, trigger_src: CardId) -> i32 {
    // Check per-card LKI captured at zone-change time (most accurate).
    if let Some(lki) = game.card(trigger_src).lki_toughness {
        return lki;
    }
    // No per-card LKI — fall back to periodic snapshot.
    if let Some(snapshot) = game.get_lki_snapshot(trigger_src) {
        return snapshot.toughness;
    }
    0
}

/// Resolve LKI counter count for a trigger source card.
///
/// Used by death triggers that reference `TriggeredCard$CardCounters.TYPE`
/// (e.g. Servant of the Scale, Modular).
///
/// Checks the per-card LKI counters first, then falls back to the periodic
/// snapshot's counter map.
///
/// Returns 0 if no LKI data or no counters of the given type exist.
pub fn resolve_lki_counter_count(
    game: &crate::game::GameState,
    trigger_src: CardId,
    counter_type: &crate::card::CounterType,
) -> i32 {
    // Check per-card LKI counters captured at zone-change time.
    let card = game.card(trigger_src);
    if let Some(&count) = card.lki_counters.as_ref().and_then(|c| c.get(counter_type)) {
        return count;
    }
    // Fall back to periodic snapshot.
    if let Some(snapshot) = game.get_lki_snapshot(trigger_src) {
        return snapshot.counters.get(counter_type).copied().unwrap_or(0);
    }
    0
}

fn trigger_card_object(sa: &SpellAbility, key: &str) -> Option<CardId> {
    crate::ability::ability_key::from_string(key)
        .and_then(|ability_key| sa.get_triggering_card(ability_key))
}

fn trigger_int_object(sa: &SpellAbility, key: &str) -> Option<i32> {
    crate::ability::ability_key::from_string(key)
        .and_then(|ability_key| sa.get_triggering_value(ability_key))
        .and_then(|value| value.trim().parse::<i32>().ok())
}

/// Resolve SVar properties that explicitly ask for triggered-card LKI.
///
/// Handles the Forge patterns used by death/leaves triggers:
/// `TriggeredCard$CardPower`, `TriggeredCard$CardToughness`, and
/// `TriggeredCard$CardCounters.TYPE`.
pub fn resolve_triggered_card_lki_svar(
    game: &crate::game::GameState,
    sa: &SpellAbility,
    svar_expr: &str,
) -> Option<i32> {
    let property = svar_expr.strip_prefix("TriggeredCard$")?;
    resolve_triggered_card_lki_property(game, sa, property)
}

pub fn resolve_triggered_card_lki_property(
    game: &crate::game::GameState,
    sa: &SpellAbility,
    property: &str,
) -> Option<i32> {
    if property == "CardPower" {
        if let Some(power) = trigger_int_object(sa, "TriggeredCardPower") {
            return Some(power);
        }
        return trigger_card_object(sa, "Card")
            .or(sa.trigger_source)
            .map(|trigger_src| resolve_lki_power(game, trigger_src));
    }

    if property == "CardToughness" {
        if let Some(toughness) = trigger_int_object(sa, "TriggeredCardToughness") {
            return Some(toughness);
        }
        return trigger_card_object(sa, "Card")
            .or(sa.trigger_source)
            .map(|trigger_src| resolve_lki_toughness(game, trigger_src));
    }

    if let Some(counter_name) = property.strip_prefix("CardCounters.") {
        let counter_type = crate::ability::effects::parse_counter_type(counter_name);
        return trigger_card_object(sa, "Card")
            .or(sa.trigger_source)
            .map(|trigger_src| resolve_lki_counter_count(game, trigger_src, &counter_type));
    }

    if let Some(filter) = property.strip_prefix("Valid ") {
        let card_id = trigger_card_object(sa, "Card").or(sa.trigger_source)?;
        let source_id = sa.source?;
        let selector = crate::parsing::cached_compiled_selector(filter);
        let matched = crate::card::valid_filter::matches_valid_card_selector_with_context(
            &selector,
            game.card(card_id),
            crate::card::valid_filter::MatchContext::from_source(game.card(source_id))
                .with_game(game)
                .with_spell_ability(sa),
        );
        return Some(i32::from(matched));
    }

    None
}
