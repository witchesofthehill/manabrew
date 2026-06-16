use serde::{Deserialize, Serialize};

use crate::{
    ability::AbilityKey,
    card_trait_base::{CardTrait, MatchValidTarget},
    event::RunParams,
    game::GameState,
    parsing::{keys, Params},
    spellability::SpellAbility,
    trigger::TriggerType,
};

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerAttackerBlockedOnce {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerAttackerBlockedOnce {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerAttackerBlockedOnce {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::AttackerBlockedOnce
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let Some(attacker_ids) = params.attacker_ids.as_ref() else {
            return false;
        };

        let attackers: Vec<_> = attacker_ids
            .iter()
            .map(|&attacker_id| MatchValidTarget::Card(game.card(attacker_id)))
            .collect();

        self.valid_card.as_ref().is_none_or(|selector| {
            trigger.matches_compiled_valid(
                &MatchValidTarget::Iter(&attackers),
                selector,
                Some(trigger.base.card_trait_base.host_card(game)),
            )
        })
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        if let Some(attackers) = params.attacker_ids.as_ref() {
            sa.set_triggering_object(AbilityKey::Attackers, attackers.clone());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Attackers: {}",
            sa.get_triggering_object(AbilityKey::Attackers)
                .unwrap_or("")
        )
    }
}
