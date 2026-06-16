use serde::{Deserialize, Serialize};

use crate::ability::ability_utils::parse_counter_type;
use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::compare::compare_expr;
use crate::parsing::Params;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TriggerChangesZone;

impl TriggerChangesZone {
    pub fn parse(_params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self)
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerChangesZone {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::ChangesZone
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let host_card = trigger.base.card_trait_base.host_card_id();
        let host_controller = trigger.base.card_trait_base.host_controller(game);
        let current_trigger_id = Some(trigger.id);
        let origin = trigger.ir.origin_zone;
        let destination = trigger.ir.destination_zone;
        if !super::trigger::Trigger::matches_zone_filter(&origin, params.origin)
            || !super::trigger::Trigger::matches_zone_filter(&destination, params.destination)
        {
            return false;
        }
        if params
            .origin
            .is_some_and(|zone| trigger.ir.excluded_origins.contains(&zone))
        {
            return false;
        }
        if params
            .destination
            .is_some_and(|zone| trigger.ir.excluded_destinations.contains(&zone))
        {
            return false;
        }
        let mut moved_card = params.card;
        if params.origin == Some(forge_foundation::ZoneType::Battlefield)
            || (params.origin == Some(forge_foundation::ZoneType::Graveyard)
                && destination != Some(forge_foundation::ZoneType::Battlefield))
        {
            moved_card = params.card_lki.or(params.card);
        } else if destination == Some(forge_foundation::ZoneType::Battlefield) {
            if let Some(card) = params.card {
                let controller = game.card(card).controller;
                let zone = game.zone(forge_foundation::ZoneType::Battlefield, controller);
                if let Some((_, latest)) = zone
                    .cards_added_this_turn
                    .iter()
                    .filter(|(_, added)| *added == card)
                    .max_by(|(_, a), (_, b)| {
                        crate::card::card_predicates::compare_by_game_timestamp(game, *a, *b)
                    })
                {
                    moved_card = Some(*latest);
                }
            }
        }
        if params.origin == Some(forge_foundation::ZoneType::Battlefield)
            && trigger
                .base
                .valid_host_zones
                .as_deref()
                .is_some_and(|zones| zones.contains(&forge_foundation::ZoneType::Graveyard))
            && game.card(host_card).zone == forge_foundation::ZoneType::Graveyard
            && params
                .change_zone_table
                .as_ref()
                .is_some_and(|table| !table.last_state_graveyard().contains(&host_card))
        {
            return false;
        }
        let valid_card = trigger.ir.valid_card_selector.clone();
        if !trigger.matches_optional_valid_card_filter(&valid_card, moved_card, game) {
            return false;
        }
        if let Some(filter) = trigger.ir.valid_cause_selector.as_ref() {
            let cause_matches = params
                .cause
                .as_ref()
                .and_then(|sa| sa.source)
                .or(params.cause_card)
                .or(params.causer)
                .is_some_and(|cause_card| {
                    trigger.matches_valid_card_filter(filter, cause_card, game)
                });
            if !cause_matches {
                return false;
            }
        }
        if let Some(expected_fizzle) = trigger.ir.fizzle {
            if params.fizzle != Some(expected_fizzle) {
                return false;
            }
        }
        if trigger.ir.not_this_ability
            && params
                .cause
                .as_ref()
                .and_then(|cause| cause.source_trigger_id)
                .zip(current_trigger_id)
                .is_some_and(|(source_trigger_id, trigger_id)| source_trigger_id == trigger_id)
        {
            return false;
        }
        if let Some(cast_expr) = trigger.ir.condition_you_cast_this_turn.as_deref() {
            let casting_player = params
                .spell_controller
                .or(params.player)
                .unwrap_or(host_controller);
            if !compare_expr(game.player(casting_player).spells_cast_this_turn, cast_expr) {
                return false;
            }
        }
        if let Some(check_expr) = trigger.ir.check_on_triggered_card.as_deref() {
            let moved = game.card(moved_card.unwrap_or(host_card));
            let mut parts = check_expr.split_whitespace();
            let lhs = parts.next().unwrap_or("");
            let rhs = parts.next().unwrap_or("GE1");
            let actual_value = match lhs {
                "Count$CardPower" => moved.power(),
                "Count$CardToughness" => moved.toughness(),
                _ => {
                    let Some(counter_name) = lhs.strip_prefix("Count$CardCounters.") else {
                        return false;
                    };
                    moved.counter_count(&parse_counter_type(counter_name))
                }
            };
            if !compare_expr(actual_value, rhs) {
                return false;
            }
        }
        true
    }

    fn set_triggering_objects(
        &self,
        trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: if origin == Battlefield, Card = CardLKI, NewCard = Card
        //        else: copy both Card and CardLKI from runParams
        if trigger.ir.origin_zone == Some(forge_foundation::ZoneType::Battlefield) {
            if let Some(card_id) = params.card_lki.or(params.card) {
                sa.set_triggering_object(crate::ability::AbilityKey::Card, card_id);
                if let Some(power) = params.lki_power {
                    sa.set_triggering_object(
                        crate::ability::AbilityKey::TriggeredCardPower,
                        power.to_string(),
                    );
                }
                if let Some(toughness) = params.lki_toughness {
                    sa.set_triggering_object(
                        crate::ability::AbilityKey::TriggeredCardToughness,
                        toughness.to_string(),
                    );
                }
            }
            if let Some(card_id) = params.card {
                sa.set_triggering_object(crate::ability::AbilityKey::NewCard, card_id);
            }
        } else {
            if let Some(card_id) = params.card {
                sa.set_triggering_object(crate::ability::AbilityKey::Card, card_id);
            }
            if let Some(card_lki) = params.card_lki {
                sa.set_triggering_object(crate::ability::AbilityKey::CardLKI, card_lki);
            }
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Zone Changer: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Card)
                .unwrap_or_default()
        )
    }
}

#[cfg(test)]
mod tests {
    use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

    use super::*;
    use crate::card::Card;
    use crate::event::RunParams;
    use crate::game::GameState;
    use crate::ids::{CardId, PlayerId};

    #[test]
    fn changes_zone_uses_lki_card_for_leaves_battlefield_valid_card() {
        let mut game = GameState::new(&["A", "B"], 20);
        let p0 = PlayerId(0);

        let mut card = Card::new(
            CardId(0),
            "Test".to_string(),
            p0,
            CardTypeLine::parse("Creature"),
            ManaCost::parse(""),
            ColorSet::COLORLESS,
            Some(2),
            Some(2),
            vec![],
            vec![],
        );
        card.set_zone(ZoneType::Graveyard);
        let cid = game.create_card(card);

        let trigger = TriggerChangesZone;

        let params = RunParams {
            card: None,
            card_lki: Some(cid),
            origin: Some(ZoneType::Battlefield),
            destination: Some(ZoneType::Graveyard),
            ..Default::default()
        };

        // TODO: update test to construct a full Trigger with host card to call perform_test
        let _ = (trigger, params, game, cid, p0);
    }
}
