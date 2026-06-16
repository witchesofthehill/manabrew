use serde::{Deserialize, Serialize};

use crate::event::RunParams;
use crate::game::GameState;
use crate::parsing::{keys, Params};
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

use super::trigger::{Trigger, TriggerBehavior};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerLifeGained {
    pub valid_player: Option<crate::parsing::CompiledSelector>,
    pub valid_source: Option<crate::parsing::CompiledSelector>,
    pub first_time_only: bool,
    pub spell_only: bool,
}

impl TriggerLifeGained {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_player: params.selector_cloned(keys::VALID_PLAYER),
            valid_source: params.selector_cloned(keys::VALID_SOURCE),
            first_time_only: params.has("FirstTime"),
            spell_only: params.has("Spell"),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerLifeGained {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::LifeGained
    }

    fn perform_test(&self, trigger: &Trigger, params: &RunParams, game: &GameState) -> bool {
        if !trigger.matches_optional_valid_player_filter(&self.valid_player, params.player, game) {
            return false;
        }
        if let Some(filter) = self.valid_source.as_ref() {
            let source_matches = params
                .source_card
                .or(params.spell_card)
                .is_some_and(|source| trigger.matches_valid_card_filter(filter, source, game));
            if !source_matches {
                return false;
            }
        }
        if self.first_time_only && params.first_time != Some(true) {
            return false;
        }
        if self.spell_only
            && !params
                .source_sa
                .as_ref()
                .or(params.spell_ability.as_ref())
                .is_some_and(|sa| sa.is_spell)
        {
            return false;
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
        if let Some(amount) = params.life_amount {
            sa.set_triggering_object(crate::ability::AbilityKey::LifeAmount, amount.to_string());
        }
        if let Some(p) = params.player {
            sa.set_triggering_object(crate::ability::AbilityKey::Player, p.0.to_string());
        }
    }

    fn get_important_stack_objects(&self, _trigger: &Trigger, sa: &SpellAbility) -> String {
        // Java: "Player: " + Player + ", GainedAmount: " + LifeAmount
        format!(
            "Player: {}, GainedAmount: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Player)
                .unwrap_or_default(),
            sa.get_triggering_object(crate::ability::AbilityKey::LifeAmount)
                .unwrap_or_default()
        )
    }
}
