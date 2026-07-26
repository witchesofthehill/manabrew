use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerCounterAddedAll {
    pub counter_type: Option<String>,
    pub valid: Option<crate::parsing::CompiledSelector>,
    pub valid_source: Option<crate::parsing::CompiledSelector>,
}

impl TriggerCounterAddedAll {
    pub fn parse(
        counter_type: Option<String>,
        valid: Option<crate::parsing::CompiledSelector>,
        valid_source: Option<crate::parsing::CompiledSelector>,
    ) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            counter_type,
            valid,
            valid_source,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerCounterAddedAll {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::CounterAddedAll
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        matching_entries(self, trigger, params, game)
            .next()
            .is_some()
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        game: &GameState,
    ) {
        let entries: Vec<_> = matching_entries(self, _trigger, params, game).collect();
        let mut cards = Vec::new();
        let mut players = Vec::new();
        let mut amount = 0;
        for entry in entries {
            if let Some(card) = entry.object_card {
                if !cards.contains(&card) {
                    cards.push(card);
                }
            }
            if let Some(player) = entry.object_player {
                if !players.contains(&player) {
                    players.push(player);
                }
            }
            amount += entry
                .counters
                .iter()
                .filter(|(counter_type, _)| {
                    self.counter_type
                        .as_ref()
                        .is_none_or(|expected| expected.eq_ignore_ascii_case(counter_type))
                })
                .map(|(_, amount)| *amount)
                .sum::<i32>();
        }
        let objects = cards
            .into_iter()
            .map(crate::agent::GameEntity::Card)
            .chain(players.into_iter().map(crate::agent::GameEntity::Player))
            .collect();
        sa.set_triggering_value(
            crate::ability::AbilityKey::Objects,
            crate::event::AbilityValue::GameEntities(objects),
        );
        sa.set_triggering_object(crate::ability::AbilityKey::Amount, amount.to_string());
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

fn matching_entries<'a>(
    behavior: &'a TriggerCounterAddedAll,
    trigger: &'a super::trigger::Trigger,
    params: &'a RunParams,
    game: &'a GameState,
) -> impl Iterator<Item = &'a crate::event::CounterTableEntry> {
    params
        .counter_table
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter(move |entry| {
            if let Some(filter) = &behavior.valid_source {
                let Some(source) = entry.source else {
                    return false;
                };
                if !trigger.matches_valid_player_filter(filter, source, game) {
                    return false;
                }
            }
            if let Some(filter) = &behavior.valid {
                let matches = entry
                    .object_card
                    .is_some_and(|card| trigger.matches_valid_card_filter(filter, card, game))
                    || entry.object_player.is_some_and(|player| {
                        trigger.matches_valid_player_filter(filter, player, game)
                    });
                if !matches {
                    return false;
                }
            }
            entry.counters.iter().any(|(counter_type, amount)| {
                *amount > 0
                    && behavior
                        .counter_type
                        .as_ref()
                        .is_none_or(|expected| expected.eq_ignore_ascii_case(counter_type))
            })
        })
}
