use serde::{Deserialize, Serialize};

use crate::ability::AbilityKey;
use crate::event::{AbilityValue, RunParams};
use crate::game::GameState;
use crate::ids::CardId;
use crate::parsing::compare::compare_expr;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerChangesZoneAll {
    pub origin: Option<forge_foundation::ZoneType>,
    pub destination: Option<forge_foundation::ZoneType>,
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub valid_cause: Option<crate::parsing::CompiledSelector>,
    pub first_time_only: bool,
    pub valid_amount: Option<String>,
}

impl TriggerChangesZoneAll {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        let origin = params.zone_type(keys::ORIGIN);
        let destination = params.zone_type(keys::DESTINATION);
        let valid_card = params.selector_cloned_any(&[keys::VALID_CARDS, keys::VALID_CARD]);
        let valid_cause = params.selector_cloned(keys::VALID_CAUSE);
        let first_time_only = params.has("FirstTime");
        let valid_amount = params.get_cloned("ValidAmount");
        Box::new(Self {
            origin,
            destination,
            valid_card,
            valid_cause,
            first_time_only,
            valid_amount,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerChangesZoneAll {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::ChangesZoneAll
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let host_card = trigger.base.card_trait_base.host_card_id();
        let host_controller = trigger.base.card_trait_base.host_controller(game);
        let table = match params.get_value(AbilityKey::Cards) {
            Some(AbilityValue::CardZoneTable(table)) => Some(table),
            _ => None,
        };

        if let Some(filter) = &self.valid_cause {
            let Some(cause_card) = (match params.get_value(AbilityKey::Cause) {
                Some(AbilityValue::SpellAbility(sa)) => sa.source,
                Some(AbilityValue::Card(card)) => Some(card),
                _ => None,
            }) else {
                return false;
            };
            if !trigger.matches_valid_card_filter(filter, cause_card, game) {
                return false;
            }
        }

        let matching: Vec<CardId> = if let Some(table) = table.as_ref() {
            let origins = self.origin.map(|zone| vec![zone]);
            let destinations = self.destination.map(|zone| vec![zone]);
            table.filter_cards(
                game,
                origins.as_deref(),
                destinations.as_deref(),
                self.valid_card.as_ref(),
                host_card,
                host_controller,
            )
        } else {
            let Some(zone_changes) = params.zone_changes.as_ref() else {
                return false;
            };
            zone_changes
                .iter()
                .filter(|zc| self.origin.is_none_or(|expected| zc.origin == expected))
                .filter(|zc| {
                    self.destination
                        .is_none_or(|expected| zc.destination == expected)
                })
                .filter_map(|zc| {
                    if trigger.matches_optional_valid_card_filter(
                        &self.valid_card,
                        Some(zc.card),
                        game,
                    ) {
                        Some(zc.card)
                    } else {
                        None
                    }
                })
                .collect()
        };

        if matching.is_empty() {
            return false;
        }

        if self.first_time_only {
            if let Some(table) = table.as_ref() {
                let seen_before = table
                    .filter_cards(
                        game,
                        self.origin.map(|zone| vec![zone]).as_deref(),
                        self.destination.map(|zone| vec![zone]).as_deref(),
                        self.valid_card.as_ref(),
                        host_card,
                        host_controller,
                    )
                    .into_iter()
                    .filter(|card| !matching.contains(card))
                    .count();
                if seen_before > 0 {
                    return false;
                }
            } else {
                for &card_id in &matching {
                    let card = game.card(card_id);
                    let zone_owner = if card.zone == forge_foundation::ZoneType::Battlefield {
                        card.controller
                    } else {
                        card.owner
                    };
                    let zone = game.zone(card.zone, zone_owner);
                    let seen_before = zone
                        .cards_added_this_turn
                        .iter()
                        .filter(|(_, seen_card)| !matching.contains(seen_card))
                        .filter(|(seen_origin, seen_card)| {
                            self.origin.is_none_or(|expected| *seen_origin == expected)
                                && trigger.matches_optional_valid_card_filter(
                                    &self.valid_card,
                                    Some(*seen_card),
                                    game,
                                )
                        })
                        .count();
                    if seen_before > 0 {
                        return false;
                    }
                }
            }
        }

        if let Some(amount_filter) = &self.valid_amount {
            return compare_expr(matching.len() as i32, amount_filter);
        }

        true
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // TODO: Java calls this.filterCards(table) to filter by ValidCards param,
        // but we don't have access to the trigger params here. Passing through all cards.
        if let Some(cards) = params.cards.as_ref() {
            let csv = cards
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Cards, &csv);
            sa.set_triggering_object(crate::ability::AbilityKey::Amount, cards.len().to_string());
            // Also set trigger_remembered_amount so TriggerCount$Amount SVars
            // (e.g. Woodland Champion's CounterNum$ X where X = TriggerCount$Amount)
            // resolve to the correct count instead of defaulting to 1.
            sa.trigger_remembered_amount = cards.len() as i32;
        }
        // TODO: Java also sets Cause from runParams via
        // sa.setTriggeringObjectsFrom(runParams, AbilityKey.Cause)
        // Skipping Cause for now since SpellAbility is complex and stored as object in Java
    }

    fn origin_zone(&self) -> Option<forge_foundation::ZoneType> {
        self.origin
    }

    fn destination_zone(&self) -> Option<forge_foundation::ZoneType> {
        self.destination
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Amount: {}",
            sa.trigger_objects
                .get(&crate::ability::AbilityKey::Amount)
                .cloned()
                .unwrap_or_default()
        )
    }
}
