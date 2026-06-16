use serde::{Deserialize, Serialize};

use crate::{
    event::RunParams,
    game::GameState,
    parsing::{keys, Params},
    spellability::SpellAbility,
    trigger::TriggerType,
};

use super::trigger::TriggerBehavior;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerBecomesTargetOnce {
    pub valid_card: Option<crate::parsing::CompiledSelector>,
}

impl TriggerBecomesTargetOnce {
    pub fn parse(params: &Params) -> Box<dyn TriggerBehavior> {
        Box::new(Self {
            valid_card: params.selector_cloned(keys::VALID_CARD),
        })
    }
}

#[typetag::serde]
impl TriggerBehavior for TriggerBecomesTargetOnce {
    fn trigger_type(&self) -> TriggerType {
        TriggerType::BecomesTargetOnce
    }

    fn perform_test(
        &self,
        trigger: &super::trigger::Trigger,
        params: &RunParams,
        game: &GameState,
    ) -> bool {
        let _host_card = trigger.base.card_trait_base.host_card_id();
        let _host_controller = trigger.base.card_trait_base.host_controller(game);
        trigger.matches_optional_valid_card_filter(&self.valid_card, params.card, game)
    }

    fn set_triggering_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &mut SpellAbility,
        params: &RunParams,
        _game: &GameState,
    ) {
        // Java: sa.setTriggeringObjectsFrom(runParams, AbilityKey.SourceSA, AbilityKey.Targets);
        // SourceSA is a complex object; we store what we can
        // Java: sa.setTriggeringObject(AbilityKey.Source, ((SpellAbility) runParams.get(AbilityKey.SourceSA)).getHostCard());
        if let Some(ref source_sa) = params.source_sa {
            if let Some(source_card) = source_sa.source {
                sa.set_triggering_object(
                    crate::ability::AbilityKey::Source,
                    source_card.0.to_string(),
                );
            }
        } else if let Some(source) = params.source_card {
            sa.set_triggering_object(crate::ability::AbilityKey::Source, source.0.to_string());
        }
        // Targets from the batch targeting event
        if let Some(card) = params.target_card.or(params.card) {
            sa.set_triggering_object(crate::ability::AbilityKey::Targets, card.0.to_string());
        } else if let Some(p) = params.target_player {
            sa.set_triggering_object(crate::ability::AbilityKey::Targets, p.0.to_string());
        }
    }

    fn get_important_stack_objects(
        &self,
        _trigger: &super::trigger::Trigger,
        sa: &SpellAbility,
    ) -> String {
        format!(
            "Source: {}, Targets: {}",
            sa.get_triggering_object(crate::ability::AbilityKey::Source)
                .unwrap_or(""),
            sa.get_triggering_object(crate::ability::AbilityKey::Targets)
                .unwrap_or("")
        )
    }
}
