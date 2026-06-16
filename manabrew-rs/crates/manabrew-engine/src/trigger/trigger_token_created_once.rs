use serde::{Deserialize, Serialize};

use crate::ability::AbilityKey;
use crate::event::{AbilityValue, RunParams};
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerTokenCreatedOnce {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
    pub only_first: Option<crate::parsing::CompiledSelector>,
}

impl TriggerTokenCreatedOnce {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        let valid_card = params.selector_cloned_any(&["ValidToken", keys::VALID_CARD]);
        let only_first = params.selector_cloned("OnlyFirst");
        Box::new(Self {
            valid_card,
            only_first,
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerTokenCreatedOnce {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::TokenCreatedOnce
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        let Some(AbilityValue::Cards(cards)) = params.get_value(AbilityKey::Cards) else {
            return false;
        };
        let any_match = cards.iter().any(|&card_id| {
            trigger.matches_optional_valid_card_filter(&self.valid_card, Some(card_id), game)
        });
        if !any_match {
            return false;
        }
        if let Some(filter) = self.only_first.as_ref() {
            let Some(AbilityValue::Players(players)) = params.get_value(AbilityKey::FirstTime)
            else {
                return false;
            };
            if !players
                .iter()
                .copied()
                .any(|pid| trigger.matches_valid_player_filter(filter, pid, game))
            {
                return false;
            }
        }
        true
    }

    fn set_triggering_objects(
        &self,
        _trigger: &Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // TODO: port ValidToken filtering from Java (IterableUtil.filter with CardPredicates.restriction)
        if let Some(cards) = params.cards.as_ref() {
            let csv = cards
                .iter()
                .map(|c| c.0.to_string())
                .collect::<Vec<_>>()
                .join(",");
            sa.set_triggering_object(crate::ability::AbilityKey::Cards, &csv);
        }
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, _sa: &SpellAbility) -> String {
        String::new()
    }
}
